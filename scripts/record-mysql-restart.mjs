// Record one continuous browser session against the configured database:
// invalid JSON rejected in the browser, both services stopped mid-session so the
// page reports the outage, then restarted so the saved history reloads.
//
// Usage (after `npm run build`, with an optional .env selecting MySQL):
//   node --env-file-if-exists=.env scripts/record-mysql-restart.mjs [output-dir]
//
// Playwright is not a project dependency. Install it first, or point
// PLAYWRIGHT_PACKAGE at an existing installation:
//   npx playwright install chromium
//   PLAYWRIGHT_PACKAGE=/path/to/node_modules/playwright node ... scripts/record-mysql-restart.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "output/mysql-restart"));
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
      // The coordinator may still be binding its port.
    }
    await wait(200);
  }
  throw new Error("coordinator never became healthy");
}

let downstream = startDownstream();
let coordinator = startCoordinator();
await waitForHealth();

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 1080 } },
});
const page = await context.newPage();
const runButton = page.getByRole("button", { name: /^Run/ });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await wait(2000);

  // Invalid JSON is rejected in the browser, before any request is sent.
  await page.getByText("Edit request payload").click();
  const payload = page.getByLabel("JSON request payload");
  await payload.fill("{broken");
  await wait(700);
  await runButton.click();
  await page.getByRole("alert").waitFor({ timeout: 15_000 });
  await wait(3000);
  await payload.fill('{\n  "orderId": "NYC-1",\n  "quantity": 2\n}');
  await wait(1200);

  // Stop both services: the running page reports the outage.
  coordinator.kill("SIGTERM");
  downstream.kill("SIGTERM");
  await wait(1500);
  await runButton.click();
  await wait(3500);

  // Start them again and reload: the rows are still in the database.
  downstream = startDownstream();
  coordinator = startCoordinator();
  await waitForHealth();
  await page.reload({ waitUntil: "networkidle" });
  await wait(3000);

  // Reopen a saved experiment and read its run history back.
  await page.getByText("Saved experiments").click();
  await wait(1200);
  const saved = page.locator(".experiment-list button[aria-pressed]");
  await saved.first().waitFor({ timeout: 15_000 });
  await saved.nth(Math.min(2, (await saved.count()) - 1)).click();
  await wait(4000);
} finally {
  await context.close();
  await browser.close();
  coordinator.kill("SIGTERM");
  downstream.kill("SIGTERM");
}
console.log(`recorded into ${OUT}`);
