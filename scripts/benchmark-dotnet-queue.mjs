// Reproducible, actual-HTTP .NET review queue benchmark. No gRPC runner needed.
// Run after npm ci and npm run build:dotnet; synthetic data is isolated and deleted.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { dotnetCommand } from './dotnet-command.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argumentsMap = new Map(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
function integer(name, fallback, max = 1000000) {
  const value = argumentsMap.get(name) ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
    throw new Error(`--${name} must be a positive integer (max ${max})`);
  return Number(value);
}
function integers(name, fallback, max = 100000) {
  const raw = argumentsMap.get(name) ?? fallback;
  return raw.split(',').map(part => {
    if (!/^\d+$/.test(part) || Number(part) < 1 || Number(part) > max)
      throw new Error(`Invalid --${name} value: ${part}`);
    return Number(part);
  });
}
const reviewCounts = integers('reviews', '1000,10000');
const clients = integers('clients', '1,10,25', 200);
const samples = integer('samples', 100);
const warmup = integer('warmup', 20, 1000);
const pageSize = integer('pageSize', 25, 100);
// The latency acceptance target applies only to bounded pages, not legacy full-queue downloads.
const targetMs = argumentsMap.has('targetMs') ? integer('targetMs', 500, 600000) : null;
const adapterSetting = argumentsMap.get('adapter') ?? 'ef';
if (!['ef', 'sql', 'both'].includes(adapterSetting)) throw new Error('--adapter must be ef, sql, or both');
const adapters = adapterSetting === 'both' ? ['ef', 'sql'] : [adapterSetting];
const outputDir = path.resolve(argumentsMap.get('out') ?? path.join(root, 'benchmarks/results'));
const revisionLabel = argumentsMap.get('revision') ?? 'uncommitted-or-unrecorded';
const schema = await readFile(path.join(root, 'database/schema.sqlite.sql'), 'utf8');
const dll = path.join(root, 'coordinator-dotnet/bin/Release/net10.0/RelayLab.Coordinator.dll');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'relaylab-queue-bench-'));
const results = [];
const raw = [];
function percentile(times, p) {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]; // nearest-rank
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
function seed(filename, count) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const addRun = db.prepare('INSERT INTO experiment_runs(id,experiment_id,outcome,duration_ms,response_json) VALUES (?,1,\'success\',7,?)');
  const addReview = db.prepare('INSERT INTO run_reviews(run_id,researcher_id,status,feedback,reviewer_id,submitted_at,decided_at) VALUES (?,?,?,?,?,?,?)');
  const evidence = JSON.stringify({ generated: true, text: 'x'.repeat(128) });
  const statuses = ['pending', 'approved', 'rejected'];
  db.transaction(() => {
    db.prepare("INSERT INTO experiments(id,name,behavior,payload_json) VALUES (1,'Synthetic queue','healthy','{}')").run();
    for (let id = 1; id <= count; id++) {
      const status = statuses[id % statuses.length];
      addRun.run(id, evidence);
      addReview.run(id, id % 2 === 0 ? 'researcher-a' : 'researcher-b', status,
        status === 'pending' ? null : `Synthetic decision ${id}`,
        status === 'pending' ? null : 'reviewer', '2026-10-28 01:00:00',
        status === 'pending' ? null : '2026-10-28 02:00:00');
    }
  })();
  db.close();
}
async function runServer(adapter, count, task) {
  const folder = path.join(temporary, `${adapter}-${count}`);
  await mkdir(folder, { recursive: true });
  seed(path.join(folder, 'relaylab.sqlite'), count);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(dotnetCommand(), [dll], {
    cwd: root,
    env: { ...process.env, PORT: String(port), RELAYLAB_DATA_DIR: folder,
      RELAYLAB_PERSISTENCE_ADAPTER: adapter, RELAYLAB_REVIEW_DEMO: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', x => logs.push(x.toString()));
  child.stderr.on('data', x => logs.push(x.toString()));
  try {
    let ready = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Coordinator exited: ${logs.join('')}`);
      try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Coordinator startup timeout: ${logs.join('')}`);
    const response = await fetch(base + '/api/demo-sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: 'reviewer' }), signal: AbortSignal.timeout(5000)
    });
    if (response.status !== 201) throw new Error(`Session failed: ${response.status} ${await response.text()}`);
    const token = (await response.json()).token;
    await task(base, token);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit').catch(() => {});
      child.kill('SIGTERM');
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}
async function request(base, token, endpoint) {
  const start = performance.now();
  try {
    const result = await fetch(base + endpoint, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000)
    });
    const buffer = await result.arrayBuffer();
    return { ms: performance.now() - start, bytes: buffer.byteLength,
      status: result.status, error: result.status === 200 ? '' : `HTTP ${result.status}` };
  } catch (error) {
    return { ms: performance.now() - start, bytes: 0, status: 0,
      error: error?.name === 'TimeoutError' ? 'timeout' : (error?.message ?? 'network error') };
  }
}
async function condition(base, token, endpoint, count, adapter, concurrency, mode) {
  for (let i = 0; i < warmup; i++) {
    const observed = await request(base, token, endpoint);
    if (observed.error) throw new Error(`Warm-up failed for ${adapter} ${endpoint}: ${observed.error}`);
  }
  let next = 0;
  const measurements = new Array(samples);
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      if (index >= samples) break;
      measurements[index] = await request(base, token, endpoint);
    }
  }));
  const elapsedMs = performance.now() - started;
  const successes = measurements.filter(r => !r.error);
  const durations = successes.map(r => r.ms);
  const failures = measurements.length - successes.length;
  const record = { revisionLabel, adapter, reviews: count, clients: concurrency, mode,
    endpoint, samples, warmup, successes: successes.length, failures,
    p50Ms: percentile(durations, 50), p95Ms: percentile(durations, 95),
    requestsPerSecond: +(measurements.length / (elapsedMs / 1000)).toFixed(2),
    meanResponseBytes: successes.length ? Math.round(successes.reduce((sum,r) => sum+r.bytes, 0) / successes.length) : null,
    elapsedMs: +elapsedMs.toFixed(2),
    // Legacy reads deliberately transfer a different payload; judging both endpoints
    // against a page-refresh SLA would conflate compatibility with performance.
    targetMs: mode === `page${pageSize}` ? targetMs : null,
    meetsTarget: mode === `page${pageSize}` && targetMs !== null
      ? (failures === 0 && durations.length > 0 && percentile(durations, 95) <= targetMs)
      : null };
  for (let i = 0; i < measurements.length; i++) raw.push({ ...{ adapter, reviews: count, clients: concurrency, mode, request: i+1 }, ...measurements[i] });
  results.push(record);
  console.log(`${adapter} reviews=${count} clients=${concurrency} ${mode}: p95=${record.p95Ms?.toFixed(2) ?? 'n/a'} ms; completed=${record.successes}/${samples}; bytes=${record.meanResponseBytes}`);
}
try {
  for (const [adapterIndex, adapter] of adapters.entries()) {
    for (const [countIndex, count] of reviewCounts.entries()) {
      await runServer(adapter, count, async (base, token) => {
        for (const [clientIndex, concurrency] of clients.entries()) {
          // Alternate endpoint order across scenarios to reduce systematic
          // first/second workload bias (not a substitute for repeat runs).
          const modes = [
            ['legacy', '/api/reviews'],
            [`page${pageSize}`, `/api/reviews?page=1&pageSize=${pageSize}`]
          ];
          if ((adapterIndex + countIndex + clientIndex) % 2) modes.reverse();
          for (const [mode, endpoint] of modes)
            await condition(base, token, endpoint, count, adapter, concurrency, mode);
        }
      });
    }
  }
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `review-queue-${timestamp}`;
  const metadata = { generatedAt: new Date().toISOString(), revisionLabel,
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      osRelease: os.release(), cpuModel: os.cpus()[0]?.model,
      cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
    note: 'Local synthetic loopback workload; p95 uses nearest-rank success-only durations; failures reported separately. Configured target applies only to bounded page responses. Endpoints alternate order between scenarios. This is not production evidence or a repeat-run stability test. Legacy and paged return different response sizes by design.',
    results };
  await writeFile(path.join(outputDir, `${prefix}.json`), JSON.stringify(metadata, null, 2) + '\n');
  const cols = ['adapter','reviews','clients','mode','request','ms','bytes','status','error'];
  await writeFile(path.join(outputDir, `${prefix}.csv`), cols.join(',') + '\n' +
    raw.map(row => cols.map(key => JSON.stringify(row[key])).join(',')).join('\n') + '\n');
  console.log(JSON.stringify({ result: 'completed', outputDir, results }, null, 2));
} finally {
  await rm(temporary, { force: true, recursive: true });
}
