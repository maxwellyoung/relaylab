// Public HTTP compatibility checks against independently built .NET and gRPC
// processes. Only this script's disposable directory and children are changed.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dotnetCommand } from './dotnet-command.mjs';
import { openDatabase } from '../server/dist/database.js';
import { experimentRunResponseV1Schema, experimentDetailsResponseV1Schema } from '../server/dist/public-contract.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'relaylab-dotnet-'));
const dotnet = dotnetCommand();
const slice = process.argv.includes('--crud') ? 'crud' : 'all';
const output = [];
const children = [];
const evidence = [];
async function port() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
const publicPort = await port();
const runnerPort = await port();
const base = `http://127.0.0.1:${publicPort}`;
function start(command, args, env = {}, ipc = false) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  child.on('message', message => { if (message?.type === 'runner-ready') child.runnerReady = true; });
  child.on('error', error => output.push(error.message));
  child.stdout.on('data', data => output.push(data.toString())); child.stderr.on('data', data => output.push(data.toString()));
  children.push(child); return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await ended; } finally { clearTimeout(timer); }
}
async function wait(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${label}\n${output.join('')}`);
}
async function http(resource, { method = 'GET', body, token, key, status = 200 } = {}) {
  const response = await fetch(base + resource, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
  assert.equal(response.status, status, `${method} ${resource}: ${await response.clone().text()}`);
  return response.status === 204 ? undefined : response.json();
}
const dll = path.join(root, 'coordinator-dotnet/bin/Release/net10.0/RelayLab.Coordinator.dll');
const environment = { PORT: String(publicPort), RELAYLAB_DATA_DIR: path.join(directory, 'coordinator'), RELAYLAB_REVIEW_DEMO: 'true', CLIENT_DIST_DIR: path.join(root, 'client/dist') };
if (slice === 'all') Object.assign(environment, { RELAYLAB_RUNNER_TARGET: `127.0.0.1:${runnerPort}`, DOWNSTREAM_TIMEOUT_MS: '300' });
function coordinator() { return start(dotnet, [dll], environment); }
try {
  // Seed through the original Node repository, close it, then start .NET over
  // the exact same file. This proves migration compatibility without touching
  // the user's database or depending on a mock of either adapter.
  const legacy = openDatabase(path.join(directory, 'legacy.sqlite'));
  const legacyExperiment = await legacy.createExperiment({ name: 'Existing Node receipt', behavior: 'healthy', payload: { legacy: true } });
  const legacyRun = await legacy.createRun({ experimentId: legacyExperiment.id, outcome: 'success', httpStatus: 200, rpcErrorCode: null, idempotencyKey: null, durationMs: 1, response: { jsonrpc: '2.0', id: 'legacy' } });
  const legacyReview = await legacy.createReview(legacyRun.id, 'researcher-a');
  await legacy.decideReview(legacyReview.id, 'approved', 'Pre-migration feedback.', 'reviewer');
  await legacy.close();
  const { mkdir, copyFile } = await import('node:fs/promises');
  await mkdir(environment.RELAYLAB_DATA_DIR, { recursive: true });
  await copyFile(path.join(directory, 'legacy.sqlite'), path.join(environment.RELAYLAB_DATA_DIR, 'relaylab.sqlite'));
  let runner;
  if (slice === 'all') {
    runner = start(process.execPath, ['runner/dist/server.js'], { RUNNER_PORT: String(runnerPort), RUNNER_DATA_DIR: path.join(directory, 'runner'), RUNNER_SLOW_DELAY_MS: '900' }, true);
    await wait(() => runner.runnerReady, 'Initial runner did not become ready');
  }
  let api = coordinator();
  await wait(async () => (await http('/health')).status === 'ok', '.NET coordinator did not become ready');
  await http('/api/experiments', { method: 'POST', body: { name: ' ', behavior: 'healthy', payload: {} }, status: 400 });
  await http('/api/experiments', { method: 'POST', body: { name: 'Invalid payload', behavior: 'healthy', payload: [] }, status: 400 });
  const item = await http('/api/experiments', { method: 'POST', status: 201, body: { name: ' .NET persistence ', behavior: 'healthy', payload: { sample: 42 } } });
  assert.equal(item.name, '.NET persistence'); assert.deepEqual(item.payload, { sample: 42 });
  assert.equal((await http('/api/experiments'))[0].id, item.id);
  assert.deepEqual((await http(`/api/experiments/${item.id}`)).runs, []);
  await http('/api/experiments/1junk', { status: 404 });
  await stop(api); api = coordinator();
  await wait(async () => (await http('/health')).status === 'ok', 'Restart failed');
  assert.equal((await http(`/api/experiments/${item.id}`)).name, item.name);
  await http(`/api/experiments/${item.id}`, { method: 'DELETE', status: 204 });
  await http(`/api/experiments/${item.id}`, { status: 404 });
  evidence.push('validated CRUD and real SQLite persistence after process restart');
  if (slice === 'all') {
    const healthy = await http('/api/experiments', { method: 'POST', status: 201, body: { name: 'Real .NET gRPC', behavior: 'healthy', payload: { note: 'synthetic contract check', nested: { values: [1, true, null] } } } });
    const run = await http(`/api/experiments/${healthy.id}/runs`, { method: 'POST', status: 201, key: 'stable-healthy' });
    assert.equal(run.outcome, 'success'); assert.equal(run.response.transport, 'grpc'); assert.equal(run.response.grpcStatus, 0);
    experimentRunResponseV1Schema.parse(run);
    experimentDetailsResponseV1Schema.parse(await http(`/api/experiments/${healthy.id}`));
    assert.equal((await http(`/api/experiments/${healthy.id}/runs`, { method: 'POST', key: 'stable-healthy' })).id, run.id);
    assert.equal((await http(`/api/runs/${run.id}/execution`)).executionId, run.response.execution.executionId);
    const slow = await http('/api/experiments', { method: 'POST', status: 201, body: { name: 'Deadline', behavior: 'slow', payload: {} } });
    const attempt = await http(`/api/experiments/${slow.id}/runs`, { method: 'POST', status: 201, key: 'stable-slow' });
    assert.equal(attempt.outcome, 'timeout'); assert.equal(attempt.rpcErrorCode, 4);
    await wait(async () => (await http(`/api/runs/${attempt.id}/execution`)).state === 'COMPLETED', 'Slow execution did not recover');
    const recovered = await http(`/api/experiments/${slow.id}/runs`, { method: 'POST', status: 201, key: 'stable-slow' });
    assert.equal(recovered.outcome, 'success');
    for (const [behavior, outcome] of [['unavailable', 'downstream_error'], ['malformed', 'invalid_response']]) {
      const item = await http('/api/experiments', { method: 'POST', status: 201, body: { name: behavior, behavior, payload: {} } });
      assert.equal((await http(`/api/experiments/${item.id}/runs`, { method: 'POST', status: 201 })).outcome, outcome);
    }
    await stop(runner);
    assert.equal((await http(`/api/experiments/${healthy.id}/runs`, { method: 'POST', status: 201, key: 'runner-down' })).outcome, 'unreachable');
    await http(`/api/runs/${run.id}/execution`, { status: 503 });
    runner = start(process.execPath, ['runner/dist/server.js'], { RUNNER_PORT: String(runnerPort), RUNNER_DATA_DIR: path.join(directory, 'runner') }, true);
    await wait(() => runner.runnerReady, 'Restarted runner did not become ready');
    await wait(async () => (await http(`/api/runs/${run.id}/execution`)).state === 'COMPLETED', 'Runner restart did not retain execution');
    assert.equal((await http(`/api/experiments/${healthy.id}/runs`, { method: 'POST', status: 201, key: 'runner-down' })).outcome, 'success');
    evidence.push('real .NET-to-Node protobuf calls, deadlines, classified failures, replay and runner restart');
    await http('/api/reviews', { status: 401 });
    await http('/api/demo-sessions', { method: 'POST', status: 400, body: { actorId: 'reviewer', role: 'researcher' } });
    const session = async actorId => (await http('/api/demo-sessions', { method: 'POST', status: 201, body: { actorId } })).token;
    let researcher = await session('researcher-a');
    const other = await session('researcher-b'); const reviewer = await session('reviewer');
    const inherited = await http(`/api/reviews/${legacyReview.id}`, { token: researcher });
    assert.equal(inherited.feedback, 'Pre-migration feedback.'); assert.deepEqual(inherited.run, legacyRun);
    await http(`/api/runs/${run.id}/reviews`, { method: 'POST', token: reviewer, status: 403 });
    const review = await http(`/api/runs/${run.id}/reviews`, { method: 'POST', token: researcher, status: 201 });
    assert.equal(review.status, 'pending'); assert.equal(review.run.outcome, 'success');
    await http(`/api/runs/${run.id}/reviews`, { method: 'POST', token: other, status: 409 });
    assert.equal((await http('/api/reviews', { token: other })).length, 0);
    await http(`/api/reviews/${review.id}`, { token: other, status: 404 });
    await http(`/api/reviews/${review.id}`, { method: 'PATCH', token: researcher, status: 403, body: { status: 'approved', feedback: 'Forbidden role' } });
    await http(`/api/reviews/${review.id}`, { method: 'PATCH', token: reviewer, status: 400, body: { status: 'approved', feedback: ' ' } });
    await http(`/api/reviews/${review.id}`, { method: 'PATCH', token: reviewer, status: 400, body: { status: 'approved', feedback: 'Valid', researcherId: 'spoofed' } });
    const concurrent = await Promise.all(['approved', 'rejected'].map(status => fetch(base + `/api/reviews/${review.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewer}` }, body: JSON.stringify({ status, feedback: ' Single winning decision. ' }) })));
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    const decided = await http(`/api/reviews/${review.id}`, { token: researcher });
    assert.equal(decided.feedback, 'Single winning decision.'); assert.equal(decided.run.outcome, 'success');
    await http(`/api/experiments/${healthy.id}`, { method: 'DELETE', status: 409 });
    await http('/api/demo-sessions/current', { method: 'DELETE', token: reviewer, status: 204 });
    await http('/api/reviews', { token: reviewer, status: 401 });
    await stop(api); api = coordinator();
    await wait(async () => (await http('/health')).status === 'ok', 'Restart with reviews failed');
    await http('/api/reviews', { token: researcher, status: 401 });
    researcher = await session('researcher-a');
    assert.deepEqual(await http(`/api/reviews/${review.id}`, { token: researcher }), decided);
    const negative = await http(`/api/runs/${attempt.id}/reviews`, { method: 'POST', token: researcher, status: 201 });
    const freshReviewer = await session('reviewer');
    await http(`/api/reviews/${negative.id}`, { method: 'PATCH', token: freshReviewer, body: { status: 'rejected', feedback: 'Original deadline retained.' } });
    assert.equal((await http(`/api/reviews/${negative.id}`, { token: researcher })).run.outcome, 'timeout');
    evidence.push('role-scoped handoff, strict input validation, single-winner decisions, evidence protection, session revocation and review restart persistence');
    evidence.push('Node-created SQLite rows and review feedback read unchanged through .NET HTTP; existing public response schemas pass');
    const malformed = await fetch(base + '/api/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    assert.equal(malformed.status, 400); assert.equal(typeof (await malformed.json()).error, 'string');
    const tooLarge = await fetch(base + '/api/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Oversize', behavior: 'healthy', payload: { text: 'x'.repeat(110000) } }) });
    assert.equal(tooLarge.status, 413); assert.equal(typeof (await tooLarge.json()).error, 'string');
    await http('/api/unknown', { status: 404 });
    const page = await fetch(base + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /<title>RelayLab<\/title>/);
    evidence.push('malformed/oversized requests return bounded JSON errors; built web client served');
  }
  console.log(JSON.stringify({ result: 'passed', slice, evidence }, null, 2));
} finally {
  for (const child of children.reverse()) await stop(child);
  await rm(directory, { recursive: true, force: true });
}
