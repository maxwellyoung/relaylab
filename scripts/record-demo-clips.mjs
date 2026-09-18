// Record the demonstration footage against the configured database, one clip per
// narrated section, so the film always matches the current interface:
//
//   healthy.webm   a successful exchange with its response evidence
//   failures.webm  an RPC application error, then a deadline timeout
//   restart.webm   invalid input, both services stopped, then the history reopened
//
// Usage (after `npm run build`, with an optional .env selecting MySQL):
//   node --env-file-if-exists=.env scripts/record-demo-clips.mjs [output-dir]
//
// Playwright is not a project dependency. Install it, or point PLAYWRIGHT_PACKAGE
// at an existing installation:
//   npx playwright install chromium
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { renameSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "output/demo-clips"));
const PORT = Number(process.env.RECORD_PORT ?? 18190);
const DOWNSTREAM_PORT = Number(process.env.RECORD_DOWNSTREAM_PORT ?? 18191);
const BASE = `http://127.0.0.1:${PORT}`;

// A directory path needs require(); a bare package name resolves as an ES module.
const { chromium } = process.env.PLAYWRIGHT_PACKAGE
  ? createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE)
  : await import("playwright");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startDownstream = () => spawn(process.execPath, ["downstream/dist/server.js"], {
  cwd: ROOT,
  env: { ...process.env, DOWNSTREAM_PORT: String(DOWNSTREAM_PORT) },
  stdio: "ignore",
});
const startCoordinator = () => spawn(process.execPath, ["server/dist/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DOWNSTREAM_URL: `http://127.0.0.1:${DOWNSTREAM_PORT}` },
  stdio: "ignore",
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 125; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // Still binding its port.
    }
    await wait(200);
  }
  throw new Error("coordinator never became healthy");
}

let downstream = startDownstream();
let coordinator = startCoordinator();
await waitForHealth();

const browser = await chromium.launch();

async function record(name, act) {
  const before = new Set(readdirSync(OUT).filter((file) => file.endsWith(".webm")));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 1080 } },
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await wait(1500);
    await act(page);
  } finally {
    await context.close();
  }
  const written = readdirSync(OUT)
    .filter((file) => file.endsWith(".webm") && !before.has(file));
  if (written.length !== 1) throw new Error(`expected one new clip for ${name}`);
  renameSync(path.join(OUT, written[0]), path.join(OUT, `${name}.webm`));
  console.log(`recorded ${name}.webm`);
}

const behaviour = (page) => page.getByLabel("Dependency behavior");
const runButton = (page) => page.getByRole("button", { name: /^Run/ });

// The first load selects the newest saved experiment, which resets the chosen
// behaviour. Keep choosing until the interface confirms it, then act.
const HELP = {
  healthy: "The dependency accepts the payload and returns valid JSON.",
  unavailable: "The transport succeeds, but the RPC method returns an application error.",
  slow: "The dependency responds after the coordinator gives up.",
};

async function choose(page, value) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await behaviour(page).selectOption(value);
    await wait(500);
    if (await page.getByText(HELP[value]).count()) return;
  }
  throw new Error(`could not select ${value}`);
}

try {
  // 1. A healthy exchange, with the correlated response evidence expanded.
  await record("healthy", async (page) => {
    await choose(page, "healthy");
    await wait(600);
    await runButton(page).click();
    await page.getByRole("heading", { name: "Request completed" }).waitFor({ timeout: 30_000 });
    await wait(2200);
    await page.getByText("Response evidence").click();
    await wait(5200);
  });

  // 2. An application error over HTTP 200, then a deadline timeout.
  await record("failures", async (page) => {
    await choose(page, "unavailable");
    await wait(600);
    await runButton(page).click();
    await page.getByRole("heading", { name: "RPC method failed" }).waitFor({ timeout: 30_000 });
    await wait(4200);
    await choose(page, "slow");
    await wait(900);
    await runButton(page).click();
    await page.getByRole("heading", { name: "Deadline exceeded" }).waitFor({ timeout: 30_000 });
    await wait(5000);
  });

  // 3. Invalid input, both services stopped mid-session, then the history reopened.
  await record("restart", async (page) => {
    await page.getByText("Edit request payload").click();
    const payload = page.getByLabel("JSON request payload");
    await payload.fill("{broken");
    await wait(700);
    await runButton(page).click();
    await page.getByRole("alert").waitFor({ timeout: 15_000 });
    await wait(2600);
    await payload.fill('{\n  "orderId": "NYC-1",\n  "quantity": 2\n}');
    await wait(1000);

    coordinator.kill("SIGTERM");
    downstream.kill("SIGTERM");
    await wait(1500);
    await runButton(page).click();
    await wait(3200);

    downstream = startDownstream();
    coordinator = startCoordinator();
    await waitForHealth();
    await page.reload({ waitUntil: "networkidle" });
    await wait(2400);
    await page.getByText("Saved experiments").click();
    await wait(1200);
    const saved = page.locator(".experiment-list button[aria-pressed]");
    await saved.first().waitFor({ timeout: 15_000 });
    await saved.nth(Math.min(2, (await saved.count()) - 1)).click();
    await wait(3600);
  });
} finally {
  await browser.close();
  coordinator.kill("SIGTERM");
  downstream.kill("SIGTERM");
}
console.log(`clips in ${OUT}`);
