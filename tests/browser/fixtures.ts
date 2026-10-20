import { test as base, expect, type Page } from "@playwright/test";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test port allocated");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export const test = base.extend<{
  stack: { url: string };
  actor: (name: "Researcher A" | "Researcher B" | "Reviewer") => Promise<Page>;
}>({
  stack: [
    async ({}, use, testInfo) => {
      const directory = await mkdtemp(join(tmpdir(), "relaylab-browser-"));
      const contextsLog: string[] = [];
      let child: ReturnType<typeof fork> | undefined;
      try {
        const port = await unusedPort();
        let runnerPort = await unusedPort();
        while (runnerPort === port) runnerPort = await unusedPort();
        const url = `http://127.0.0.1:${port}`;
        child = fork(resolve("scripts/start-group-dotnet.mjs"), [], {
          detached: true,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            PORT: String(port),
            RUNNER_PORT: String(runnerPort),
            RELAYLAB_GROUP_DATA_DIR: directory,
            RELAYLAB_PERSISTENCE_ADAPTER: "ef",
            DOWNSTREAM_TIMEOUT_MS: "400",
            RUNNER_SLOW_DELAY_MS: "800",
          },
        });
        const log = (chunk: Buffer) => {
          contextsLog.push(chunk.toString());
          if (contextsLog.length > 200) contextsLog.shift();
        };
        child.stdout!.on("data", log);
        child.stderr!.on("data", log);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              finish(new Error("Disposable group stack did not become ready")),
            20_000,
          );
          function finish(error?: Error) {
            clearTimeout(timer);
            child!.off("message", ready);
            child!.off("error", failed);
            child!.off("exit", exited);
            error ? reject(error) : resolve();
          }
          function ready(message: unknown) {
            if (
              message &&
              typeof message === "object" &&
              "type" in message &&
              message.type === "coordinator-ready"
            )
              finish();
          }
          function failed(error: Error) {
            finish(error);
          }
          function exited(code: number | null) {
            finish(
              new Error(
                `Disposable group stack exited before readiness (${code})`,
              ),
            );
          }
          child!.on("message", ready);
          child!.once("error", failed);
          child!.once("exit", exited);
        });
        const health = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(health.ok).toBe(true);
        expect(await health.json()).toMatchObject({
          implementation: "dotnet",
          persistenceAdapter: "ef",
          executionTransport: "grpc",
        });
        // Fresh stores are mandatory; never silently attach to a user's preview.
        const experiments = await fetch(`${url}/api/experiments`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(await experiments.json()).toEqual([]);
        await use({ url });
      } finally {
        if (child?.pid) {
          // This detached process group contains only this test's supervisor and services.
          const exit =
            child.exitCode !== null || child.signalCode !== null
              ? Promise.resolve()
              : new Promise<void>((resolve) =>
                  child!.once("exit", () => resolve()),
                );
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
          await Promise.race([exit, delay(5_000, undefined, { ref: false })]);
          // Also covers descendants if their supervisor exited early.
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
          await Promise.race([exit, delay(2_000, undefined, { ref: false })]);
        }
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("disposable-services.log", {
            body: contextsLog.join(""),
            contentType: "text/plain",
          });
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    { timeout: 30_000 },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.url);
  },
  actor: async ({ browser, baseURL, viewport, isMobile, hasTouch }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    try {
      await use(async (name) => {
        const context = await browser.newContext({
          baseURL,
          viewport,
          isMobile,
          hasTouch,
          locale: "en-NZ",
          reducedMotion: "reduce",
        });
        contexts.push(context);
        const page = await context.newPage();
        await page.goto("/");
        await page.getByRole("button", { name, exact: true }).click();
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("button", { name: "Refresh reviews", exact: true }),
        ).toBeEnabled();
        return page;
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});
export { expect };

export async function submitRun(page: Page, behavior = "healthy") {
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Dependency behavior", exact: true })
    .selectOption(behavior);
  const completed = page.waitForResponse(
    (response) =>
      /\/api\/experiments\/\d+\/runs$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Run (experiment|again)$/ }).click();
  const response = await completed;
  expect(response.status()).toBe(201);
  const run = (await response.json()) as { id: number; outcome: string };
  await page
    .getByRole("button", { name: "Open run reviews", exact: true })
    .click();
  if (behavior === "healthy") expect(run.outcome).toBe("success");
  await page
    .getByRole("button", {
      name: `Submit run #${run.id} for review`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: `Run #${run.id} submitted`, exact: true }),
  ).toBeDisabled();
  return run;
}

export async function refreshQueue(page: Page) {
  const back = page.getByRole("button", { name: "← All reviews", exact: true });
  if (await back.isVisible()) await back.click();
  await page
    .getByRole("button", { name: "Refresh reviews", exact: true })
    .click();
  await expect(
    page.getByText("Reviews refreshed.", { exact: true }),
  ).toBeVisible();
  return page.getByRole("navigation", { name: "Submitted runs", exact: true });
}

export async function openReview(page: Page, runId: number) {
  const queue = await refreshQueue(page);
  const row = queue.getByRole("button", {
    name: new RegExp(`Run #${runId}\\b`),
  });
  await row.click();
  const receipt = page.getByRole("article", {
    name: new RegExp(` · Run #${runId}$`),
  });
  await expect(receipt).toBeVisible();
  return receipt;
}
