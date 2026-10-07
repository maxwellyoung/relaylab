import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import SqliteDatabase from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'relaylab-grpc-smoke-'));
async function port() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const result = server.address().port; await new Promise((resolve) => server.close(resolve)); return result;
}
const publicPort = await port();
const runnerPort = await port();
const base = `http://127.0.0.1:${publicPort}`;
const output = [];
let runnerPid;
let coordinatorReady = false;
let replacement;
let group;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function wait(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${message}\n${output.join('')}`);
}
async function http(resource, { method = 'GET', body, token, key, status = 200 } = {}) {
  const response = await fetch(base + resource, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000) });
  assert.equal(response.status, status, `${method} ${resource}`); return response.status === 204 ? undefined : response.json();
}
async function experiment(behavior) { return http('/api/experiments', { method: 'POST', status: 201, body: { name: `gRPC smoke ${behavior}`, behavior, payload: { sample: 'grpc-smoke' } } }); }
async function execute(id, key, status = 201) { return http(`/api/experiments/${id}/runs`, { method: 'POST', status, key }); }
function tables(file) {
  const db = new SqliteDatabase(file, { readonly: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name").all(); db.close(); return rows.map((row) => row.name);
}
try {
  group = spawn(process.execPath, ['scripts/start-group.mjs'], { cwd: root, env: { ...process.env, PORT: String(publicPort), RUNNER_PORT: String(runnerPort), RELAYLAB_GROUP_DATA_DIR: directory, DOWNSTREAM_TIMEOUT_MS: '300', RUNNER_SLOW_DELAY_MS: '900' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  group.on('message', (message) => { if (message.type === 'runner-ready') runnerPid = message.pid; if (message.type === 'coordinator-ready') coordinatorReady = true; });
  for (const stream of [group.stdout, group.stderr]) stream.on('data', (value) => { output.push(value.toString()); if (output.length > 100) output.shift(); });
  await wait(async () => coordinatorReady && runnerPid && (await fetch(base + '/health')).ok, 'Group startup failed');
  assert.equal((await http('/health')).executionTransport, 'grpc');
  const researcher = (await http('/api/demo-sessions', { method: 'POST', status: 201, body: { actorId: 'researcher-a' } })).token;
  const reviewer = (await http('/api/demo-sessions', { method: 'POST', status: 201, body: { actorId: 'reviewer' } })).token;
  const healthy = await experiment('healthy');
  const run = await execute(healthy.id, 'success');
  assert.equal(run.outcome, 'success'); assert.equal(run.httpStatus, null);
  const review = await http(`/api/runs/${run.id}/reviews`, { method: 'POST', status: 201, token: researcher });
  await http(`/api/reviews/${review.id}`, { method: 'PATCH', token: reviewer, body: { status: 'approved', feedback: 'Actual gRPC result verified.' } });
  assert.equal((await http('/api/reviews', { token: researcher }))[0].status, 'approved');
  const slow = await experiment('slow');
  const attempt = await execute(slow.id, 'same-slow-operation');
  assert.equal(attempt.outcome, 'timeout'); assert.equal(attempt.rpcErrorCode, 4);
  const pending = await http(`/api/runs/${attempt.id}/execution`);
  assert.equal(pending.state, 'RUNNING');
  await wait(async () => (await http(`/api/runs/${attempt.id}/execution`)).state === 'COMPLETED', 'Accepted slow execution did not complete');
  const recovered = await execute(slow.id, 'same-slow-operation');
  assert.equal(recovered.outcome, 'success'); assert.equal(recovered.response.execution.executionId, pending.executionId);
  assert.equal((await execute(slow.id, 'same-slow-operation', 200)).id, recovered.id);
  const stopped = new Promise((resolve) => { const receive = (message) => { if (message.type === 'runner-exit') { group.off('message', receive); resolve(); } }; group.on('message', receive); });
  process.kill(runnerPid, 'SIGTERM'); await stopped;
  const missing = await execute(healthy.id, 'runner-unavailable');
  assert.equal(missing.outcome, 'unreachable'); assert.equal(missing.rpcErrorCode, 14);
  assert.equal((await http('/health')).status, 'ok');
  replacement = spawn(process.execPath, ['runner/dist/server.js'], { cwd: root, env: { ...process.env, RUNNER_PORT: String(runnerPort), RUNNER_DATA_DIR: path.join(directory, 'runner') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Replacement runner readiness timed out')), 10000);
    replacement.on('message', (message) => { if (message.type === 'runner-ready') { clearTimeout(timer); resolve(); } });
    replacement.once('exit', () => { clearTimeout(timer); reject(new Error('Replacement runner failed')); });
  });
  const replayAfterRestart = await http(`/api/runs/${run.id}/execution`);
  assert.equal(replayAfterRestart.executionId, run.response.execution.executionId);
  assert.equal((await execute(healthy.id, 'runner-unavailable')).outcome, 'success');
  assert.equal((await http('/api/reviews', { token: researcher }))[0].feedback, 'Actual gRPC result verified.');
  assert.deepEqual(tables(path.join(directory, 'coordinator', 'relaylab.sqlite')), ['experiment_runs', 'experiments', 'run_reviews']);
  assert.deepEqual(tables(path.join(directory, 'runner', 'runner.sqlite')), ['executions']);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), result: 'passed', executionId: run.response.execution.executionId, evidence: ['two independent built processes', 'real gRPC protobuf calls', 'separate SQLite stores', 'researcher/reviewer handoff', 'deadline=4 and same-key recovery', 'unavailable=14 with coordinator still usable', 'runner restart retains results and review feedback'], gates: ['selectable local demo identities', 'native Android not yet implemented', 'live MySQL not tested'] }, null, 2));
} finally {
  await stop(replacement); await stop(group); await rm(directory, { recursive: true, force: true });
}
