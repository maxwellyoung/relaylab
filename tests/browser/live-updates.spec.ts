import { test, expect, submitRun } from "./fixtures";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";

test("another role receives submission and saved feedback without manual refresh", async ({ actor }) => {
  const researcher = await actor("Researcher A");
  const reviewer = await actor("Reviewer");
  await expect(reviewer.getByText("Live updates connected", { exact: true })).toBeVisible();
  const run = await submitRun(researcher);
  const row = reviewer.getByRole("button", { name: new RegExp(`Run #${run.id}\\b`) });
  await expect(row).toBeVisible();
  await row.click();
  await reviewer.getByLabel(`Feedback for run #${run.id} (required)`).fill("Live handoff verified.");
  await reviewer.getByRole("button", { name: `Approve run #${run.id}`, exact: true }).click();
  await expect(researcher.getByText("Live handoff verified.", { exact: true })).toBeVisible();
  await expect(researcher.getByText("Approved", { exact: true })).toBeVisible();
});

test("manual HTTP review remains usable while WebSocket alone fails, then live delivery resumes", async ({ actor, browser, stack, viewport, isMobile, hasTouch }) => {
  const researcher = await actor("Researcher A");
  const context = await browser.newContext({ baseURL: stack.url, viewport, isMobile, hasTouch });
  let allowLive = false;
  await context.routeWebSocket("**/api/reviews/live", async route => {
    if (allowLive) route.connectToServer();
    else await route.close({ code: 1011, reason: "Test-only live transport interruption" });
  });
  try {
    const reviewer = await context.newPage();
    await reviewer.goto("/");
    await reviewer.getByRole("button", { name: "Reviewer", exact: true }).click();
    await expect(reviewer.getByText("Live updates disconnected; reconnecting. Refresh is available.", { exact: true })).toBeVisible();
    const run = await submitRun(researcher);
    await reviewer.getByRole("button", { name: "Refresh reviews", exact: true }).click();
    await reviewer.getByRole("button", { name: new RegExp(`Run #${run.id}\\b`) }).click();
    await reviewer.getByLabel(`Feedback for run #${run.id} (required)`).fill("HTTP fallback still works.");
    await reviewer.getByRole("button", { name: `Approve run #${run.id}`, exact: true }).click();
    await expect(researcher.getByText("HTTP fallback still works.", { exact: true })).toBeVisible();
    allowLive = true;
    await expect(reviewer.getByText("Live updates connected", { exact: true })).toBeVisible({ timeout: 10_000 });
    await submitRun(researcher);
    await expect(reviewer.getByText("1 waiting for feedback", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("records a bounded local live-review response-time workload", async ({ actor, request, stack }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One declared desktop measurement; phone behavior is covered separately.");
  test.setTimeout(120_000);
  const token = (await (await request.post(`${stack.url}/api/demo-sessions`, { data: { actorId: "researcher-a" } })).json()).token as string;
  const experiment = await (await request.post(`${stack.url}/api/experiments`, { data: { name: "Synthetic live-update workload", behavior: "healthy", payload: {} } })).json();
  async function newRun() {
    const response = await request.post(`${stack.url}/api/experiments/${experiment.id}/runs`);
    expect(response.status()).toBe(201);
    const run = await response.json(); expect(run.outcome).toBe("success"); return run;
  }
  async function submit(runId: number) {
    const response = await request.post(`${stack.url}/api/runs/${runId}/reviews`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status()).toBe(201);
  }
  for (let i = 0; i < 200; i++) await submit((await newRun()).id);
  const reviewer = await actor("Reviewer");
  await expect(reviewer.getByText("Live updates connected", { exact: true })).toBeVisible();
  await expect(reviewer.getByText("200 waiting for feedback", { exact: true })).toBeVisible();
  const samples: { sample: number; ms: number; pendingReviews: number }[] = [];
  for (let i = -2; i < 20; i++) {
    const run = await newRun();
    const start = performance.now();
    await submit(run.id);
    await expect.poll(() => reviewer.getByRole("button", { name: new RegExp(`Run #${run.id}\\b`) }).isVisible(), { intervals: [10, 25, 50] }).toBe(true);
    if (i >= 0) samples.push({ sample: i, ms: Number((performance.now() - start).toFixed(3)), pendingReviews: 203 + i });
  }
  const sorted = samples.map(x => x.ms).sort((a, b) => a - b);
  const result = {
    measuredAtUTC: new Date().toISOString(), operation: "researcher HTTP submission start to reviewer browser queue row visible via WebSocket invalidation and HTTP resync",
    proposedTargetMs: 1_000, targetRationale: "Visible peer handoff within one second on the declared local workload; engineering proposal pending team acceptance",
    method: { initialPendingReviews: 200, warmups: 2, samples: 20, finalPendingReviews: 222, driver: "one HTTP researcher, one Chromium reviewer; sequential writes", percentile: "nearest rank", observationPollingMs: [10, 25, 50], manualRefreshOrReviewPolling: false },
    environment: { os: process.platform, arch: process.arch, node: process.version, cpu: cpus()[0]?.model, browser: "Chromium desktop1280x800", transport: "loopback .NET EF SQLite + Node gRPC" },
    results: { medianMs: sorted[9], p95Ms: sorted[18], maximumMs: sorted[19], allWithinTarget: sorted.every(ms => ms <= 1_000) },
    limitations: ["includes test DOM-observation delay", "single local host; unrelated host load uncontrolled", "not production,WAN,physical Android or query optimization", "target/workload require team ratification"], samples,
  };
  await writeFile(testInfo.outputPath("live-response-time.json"), JSON.stringify(result, null, 2) + "\n");
  await testInfo.attach("live-response-time", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result.results.allWithinTarget).toBe(true);
});

test("reconnection reloads a decision missed while offline and keeps failed-link feedback honest", async ({ actor }) => {
  const researcher = await actor("Researcher A");
  const reviewer = await actor("Reviewer");
  await expect(researcher.getByText("Live updates connected", { exact: true })).toBeVisible();
  const run = await submitRun(researcher);
  const row = reviewer.getByRole("button", { name: new RegExp(`Run #${run.id}\\b`) });
  await expect(row).toBeVisible();
  await researcher.context().setOffline(true);
  await expect(researcher.getByText("Live updates disconnected; reconnecting. Refresh is available.", { exact: true })).toBeVisible();
  await row.click();
  await reviewer.getByLabel(`Feedback for run #${run.id} (required)`).fill("Saved while the other client was offline.");
  await reviewer.getByRole("button", { name: `Approve run #${run.id}`, exact: true }).click();
  await expect(researcher.getByText("Saved while the other client was offline.", { exact: true })).toHaveCount(0);
  await researcher.context().setOffline(false);
  await expect(researcher.getByText("Live updates connected", { exact: true })).toBeVisible();
  await expect(researcher.getByText("Saved while the other client was offline.", { exact: true })).toBeVisible();
});

test("live queue arrivals preserve the open review draft and keyboard focus", async ({ actor, request, stack }) => {
  const researcher = await actor("Researcher A");
  const reviewer = await actor("Reviewer");
  const first = await submitRun(researcher);
  const row = reviewer.getByRole("button", { name: new RegExp(`Run #${first.id}\\b`) });
  await row.click();
  await expect(reviewer.getByRole("heading", { name: new RegExp(`Run #${first.id}\\b`) })).toBeFocused();
  const feedback = reviewer.getByLabel(`Feedback for run #${first.id} (required)`);
  await feedback.fill("Keep this unfinished review.");
  await feedback.focus();
  await expect(feedback).toBeFocused();
  // Drive the second actor through HTTP without moving keyboard focus to another tab.
  const other = await (await request.post(`${stack.url}/api/demo-sessions`, { data: { actorId: "researcher-b" } })).json();
  const experiment = await (await request.post(`${stack.url}/api/experiments`, { data: { name: "Other researcher arrival", behavior: "healthy", payload: {} } })).json();
  const run = await (await request.post(`${stack.url}/api/experiments/${experiment.id}/runs`)).json();
  expect((await request.post(`${stack.url}/api/runs/${run.id}/reviews`, { headers: { Authorization: `Bearer ${other.token}` } })).status()).toBe(201);
  await expect(reviewer.getByText("2 waiting for feedback", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("Keep this unfinished review.");
  await expect(feedback).toBeFocused();
});

test("socket authentication, role scope and session revocation preserve HTTP data boundaries", async ({ request, stack }) => {
  async function session(actorId: string) {
    const response = await request.post(`${stack.url}/api/demo-sessions`, { data: { actorId } });
    expect(response.status()).toBe(201);
    return (await response.json()).token as string;
  }
  const sockets: WebSocket[] = [];
  async function connect(token: string, authenticated = true) {
    const socket = new WebSocket(stack.url.replace("http:", "ws:") + "/api/reviews/live");
    sockets.push(socket);
    const messages: { type: string }[] = [];
    socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
    const closed = new Promise<number>(resolve => socket.addEventListener("close", event => resolve(event.code), { once: true }));
    await expect.poll(() => socket.readyState).toBe(WebSocket.OPEN);
    socket.send(JSON.stringify({ type: "subscribe", token }));
    if (authenticated) await expect.poll(() => messages[0]).toEqual({ type: "ready" });
    return { socket, messages, closed };
  }
  try {
    const a = await session("researcher-a"), b = await session("researcher-b"), r = await session("reviewer");
    const own = await connect(a), unrelated = await connect(b), reviewer = await connect(r);
    const invalid = await connect("00000000-0000-0000-0000-000000000000", false);
    expect(await invalid.closed).toBe(1008);
    expect(invalid.messages).toEqual([]);
    const experiment = await (await request.post(`${stack.url}/api/experiments`, { data: { name: "Scoped live fixture", behavior: "healthy", payload: {} } })).json();
    const run = await (await request.post(`${stack.url}/api/experiments/${experiment.id}/runs`)).json();
    const submitted = await request.post(`${stack.url}/api/runs/${run.id}/reviews`, { headers: { Authorization: `Bearer ${a}` } });
    expect(submitted.status()).toBe(201);
    const review = await submitted.json();
    await expect.poll(() => own.messages.some(x => x.type === "reviews-changed")).toBe(true);
    await expect.poll(() => reviewer.messages.some(x => x.type === "reviews-changed")).toBe(true);
    // Observe the unrelated connection through the complete handoff, plus a bounded quiet window.
    await request.patch(`${stack.url}/api/reviews/${review.id}`, { headers: { Authorization: `Bearer ${r}` }, data: { status: "approved", feedback: "Scoped approval" } });
    await expect.poll(() => own.messages.filter(x => x.type === "reviews-changed").length).toBeGreaterThanOrEqual(2);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(unrelated.messages).toEqual([{ type: "ready" }]);
    expect((await request.get(`${stack.url}/api/reviews/${review.id}`, { headers: { Authorization: `Bearer ${b}` } })).status()).toBe(404);
    expect(await (await request.get(`${stack.url}/api/reviews`, { headers: { Authorization: `Bearer ${b}` } })).json()).toEqual([]);
    expect(own.messages.every(message => Object.keys(message).join() === "type")).toBe(true);
    expect((await request.delete(`${stack.url}/api/demo-sessions/current`, { headers: { Authorization: `Bearer ${a}` } })).status()).toBe(204);
    expect(await own.closed).toBe(1008);
    expect((await request.get(`${stack.url}/api/reviews`, { headers: { Authorization: `Bearer ${a}` } })).status()).toBe(401);
    const foreign = await request.get(`${stack.url}/api/reviews/live`, { headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13", Origin: "https://unrelated.invalid" } });
    expect(foreign.status()).toBe(403);
  } finally { for (const socket of sockets) socket.close(); }
});
