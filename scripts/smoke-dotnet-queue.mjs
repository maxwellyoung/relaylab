// Real HTTP queue-contract checks using isolated, seeded SQLite databases.
// The gRPC runner is deliberately not needed to verify read-only review listing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { dotnetCommand } from './dotnet-command.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dll = path.join(root, 'coordinator-dotnet/bin/Release/net10.0/RelayLab.Coordinator.dll');
const temp = await mkdtemp(path.join(tmpdir(), 'relaylab-queue-'));
const schema = await readFile(path.join(root, 'database/schema.sqlite.sql'), 'utf8');
const results = {};

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function seed(filename) {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.exec(schema);
  const records = [
    [101, 'researcher-a', 'pending'],
    [102, 'researcher-b', 'approved'],
    [103, 'researcher-a', 'pending'],
    [104, 'researcher-b', 'rejected'],
    [105, 'researcher-a', 'approved'],
    [106, 'researcher-b', 'pending'],
    [107, 'researcher-b', 'pending'],
    [108, 'researcher-a', 'rejected']
  ];
  const insert = database.prepare('INSERT INTO run_reviews(id,run_id,researcher_id,status,feedback,reviewer_id,submitted_at,decided_at) VALUES (?,?,?,?,?,?,?,?)');
  const addRun = database.prepare('INSERT INTO experiment_runs(id, experiment_id, outcome, duration_ms, response_json) VALUES (?, 1, ?, 5, ?)');
  database.transaction(() => {
    database.prepare("INSERT INTO experiments(id, name, behavior, payload_json) VALUES (1, 'Queue scenario', 'healthy', '{}')").run();
    for (const [id, researcher, status] of records) {
      addRun.run(id, 'success', JSON.stringify({ event: id }));
      insert.run(id, id, researcher, status, status === 'pending' ? null : `Decision ${id}`, status === 'pending' ? null : 'reviewer', '2026-10-28 01:00:00', status === 'pending' ? null : '2026-10-28 02:00:00');
    }
  })();
  database.close();
}
async function runAdapter(adapter) {
  const storage = path.join(temp, adapter);
  await mkdir(storage, { recursive: true });
  seed(path.join(storage, 'relaylab.sqlite'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const messages = [];
  const child = spawn(dotnetCommand(), [dll], {
    cwd: root,
    env: { ...process.env, RELAYLAB_DATA_DIR: storage, RELAYLAB_PERSISTENCE_ADAPTER: adapter, RELAYLAB_REVIEW_DEMO: 'true', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', x => messages.push(x.toString()));
  child.stderr.on('data', x => messages.push(x.toString()));
  let checks = 0;
  try {
    const deadline = Date.now() + 12000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Coordinator exited: ${messages.join('')}`);
      try { const r = await fetch(base + '/health', { signal: AbortSignal.timeout(750) }); if (r.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    if (!ready) throw new Error(`Coordinator did not start: ${messages.join('')}`);
    async function request(url, { token, expectedStatus = 200, method = 'GET', body } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + url, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(6000)
      });
      const data = await response.json();
      assert.equal(response.status, expectedStatus, `${adapter} ${method} ${url}: ${JSON.stringify(data)}`);
      checks++;
      return data;
    }
    async function session(actorId) {
      const r = await fetch(base + '/api/demo-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId }), signal: AbortSignal.timeout(6000) });
      assert.equal(r.status, 201);
      checks++;
      return (await r.json()).token;
    }
    await request('/api/reviews', { expectedStatus: 401 });
    const reviewer = await session('reviewer');
    const a = await session('researcher-a');
    const b = await session('researcher-b');
    const ids = rows => rows.map(r => r.id);
    const expected = [107, 106, 103, 101, 108, 105, 104, 102];
    const unfiltered = await request('/api/reviews', { token: reviewer });
    assert.deepEqual(ids(unfiltered), expected);
    assert.equal(unfiltered[0].run.id, 107); // Full legacy review evidence is preserved.
    assert.equal(unfiltered[0].experimentName, 'Queue scenario');
    assert.deepEqual(ids(await request('/api/reviews?status=pending', { token: reviewer })), [107, 106, 103, 101]);
    assert.deepEqual(ids(await request('/api/reviews?status=approved', { token: reviewer })), [105, 102]);
    assert.deepEqual(ids(await request('/api/reviews?status=rejected', { token: reviewer })), [108, 104]);
    assert.deepEqual(ids(await request('/api/reviews', { token: a })), [103, 101, 108, 105]);
    assert.deepEqual(ids(await request('/api/reviews', { token: b })), [107, 106, 104, 102]);
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=1&pageSize=2', { token: a })), [103, 101]);
    assert.deepEqual(ids(await request('/api/reviews?status=approved&page=1&pageSize=2', { token: a })), [105]);
    const pages = [];
    for (let page = 1; page <= 5; page++) {
      const rows = await request(`/api/reviews?page=${page}&pageSize=2`, { token: reviewer });
      pages.push(...ids(rows));
    }
    assert.deepEqual(pages, expected); // Unique/stable ordering across unchanged pages.
    assert.deepEqual(ids(await request('/api/reviews?page=5&pageSize=2', { token: reviewer })), []);
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=2&pageSize=2', { token: reviewer })), [103, 101]);
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=3&pageSize=2', { token: reviewer })), []);
    for (const query of [
      'status=unknown', 'status=PENDING', 'status=', 'status=%20', 'status=pending&status=approved',
      'page=1', 'pageSize=25', 'page=&pageSize=2', 'page=1&pageSize=',
      'page=0&pageSize=25', 'page=-1&pageSize=25', 'page=abc&pageSize=25',
      'page=1&pageSize=0', 'page=1&pageSize=101', 'page=1&pageSize=abc',
      'page=2147483647&pageSize=100'
    ]) {
      const error = await request(`/api/reviews?${query}`, { token: reviewer, expectedStatus: 400 });
      assert.equal(typeof error.error, 'string');
    }
    const many = await Promise.all(Array.from({ length: 20 }, () => request('/api/reviews?status=pending&page=1&pageSize=2', { token: reviewer })));
    for (const rows of many) assert.deepEqual(ids(rows), [107, 106]);
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=1&pageSize=2', { token: reviewer })), [107, 106]);
    const decision = await request('/api/reviews/107', {
      token: reviewer, method: 'PATCH',
      body: { status: 'approved', feedback: 'Status changed during pagination' }
    });
    assert.equal(decision.status, 'approved');
    // Offset pagination reflects the changed queue, so this page skips review 103.
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=2&pageSize=2', { token: reviewer })), [101]);
    assert.deepEqual(ids(await request('/api/reviews?status=pending&page=1&pageSize=2', { token: reviewer })), [106, 103]);
    results[adapter] = { checks, passed: true, legacyIds: ids(unfiltered), pendingPage: [107, 106], concurrentRequests: 20 };
    return { allIds: ids(unfiltered), pendingPage: ids(many[0]) };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}
try {
  const ef = await runAdapter('ef');
  const sql = await runAdapter('sql');
  assert.deepEqual(ef, sql);
  console.log(JSON.stringify({ result: 'passed', test: 'dotnet-review-queue', adapters: results, adapterParity: true }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
