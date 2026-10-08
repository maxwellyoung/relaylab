import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { buildApplication } from "../server/dist/app.js";
import { buildDownstreamService } from "../downstream/dist/app.js";

const directory = await mkdtemp(path.join(tmpdir(), "relaylab-review-smoke-"));
const databasePath = path.join(directory, "lab.sqlite");
const downstream = buildDownstreamService().listen(0, "127.0.0.1");
await once(downstream, "listening");
let application;
let server;
let base;
async function start() {
  application = buildApplication({ databasePath, reviewDemoEnabled: true, downstreamUrl: `http://127.0.0.1:${downstream.address().port}` });
  server = application.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await application.close();
  application = undefined;
}
async function http(resource, { token, status = 200, method = "GET", body } = {}) {
  const response = await fetch(base + resource, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method} ${resource}`);
  return status === 204 ? undefined : response.json();
}
async function session(actorId) {
  return (await http("/api/demo-sessions", { method: "POST", status: 201, body: { actorId } })).token;
}
try {
  await start();
  const researcher = await session("researcher-a");
  const reviewer = await session("reviewer");
  const experiment = await http("/api/experiments", { method: "POST", status: 201, body: { name: "Built review handoff", behavior: "healthy", payload: { sample: "local-smoke" } } });
  const run = await http(`/api/experiments/${experiment.id}/runs`, { method: "POST", status: 201 });
  assert.equal(run.outcome, "success");
  const review = await http(`/api/runs/${run.id}/reviews`, { method: "POST", status: 201, token: researcher });
  assert.equal((await http("/api/reviews", { token: reviewer }))[0].status, "pending");
  await http(`/api/reviews/${review.id}`, { method: "PATCH", token: reviewer, body: { status: "approved", feedback: "Actual downstream result verified." } });
  assert.equal((await http("/api/reviews", { token: researcher }))[0].status, "approved");
  await http(`/api/experiments/${experiment.id}`, { method: "DELETE", status: 409 });
  await stop();
  await start();
  await http("/api/reviews", { token: researcher, status: 401 });
  const resumed = await session("researcher-a");
  assert.equal((await http("/api/reviews", { token: resumed }))[0].feedback, "Actual downstream result verified.");
  // Interactive refresh target: <=500ms on a local warm coordinator, one review,
  // sequential requests, no other test load. This is not Android/network-load proof.
  const durations = [];
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    await http("/api/reviews", { token: resumed });
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const maximumMs = durations.at(-1);
  assert.ok(maximumMs <= 500, `Review refresh exceeded the local 500ms target: ${maximumMs}ms`);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), result: "passed", integration: "built web API -> JSON-RPC downstream -> SQLite review decision; actual HTTP; restart",
    refresh: { targetMs: 500, samples: durations.length, reviews: 1, p95Ms: Number(durations[18].toFixed(2)), maximumMs: Number(maximumMs.toFixed(2)), conditions: "warm local loopback, sequential, SQLite, no concurrent test load" },
    gates: ["demo identities only", "Android not exercised by this HTTP smoke", "gRPC not exercised by this JSON-RPC smoke", "live MySQL not tested"],
  }, null, 2));
} finally {
  if (application) await stop();
  await new Promise((resolve) => downstream.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
