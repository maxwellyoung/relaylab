import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stopChild, waitForHealth, captureChild, waitForUnreachable } from './smoke-support.mjs';

test('IPC shutdown lets a Node child finish its cleanup before exit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'relaylab-stop-check-'));
  const marker = path.join(directory, 'cleaned');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {writeFile} from 'node:fs/promises';
    process.on('message', async message => {
      if (message.type !== 'relaylab-shutdown') return;
      await writeFile(process.argv[1], 'cleanup finished');
      process.exit(0);
    });
    process.send({type: 'ready'});
    setInterval(() => {}, 1000);
  `, marker], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  try {
    await once(child, 'message');
    await stopChild(child, { graceMs: 1000 });
    assert.equal(await readFile(marker, 'utf8'), 'cleanup finished');
    assert.equal(child.exitCode, 0);
  } finally { await stopChild(child, { graceMs: 100 }); await rm(directory, { recursive: true, force: true }); }
});

test('unresponsive IPC child is forcibly stopped within a bounded grace period', async () => {
  const child = spawn(process.execPath, ['-e', `process.on('message', () => {}); process.send('ready'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  await once(child, 'message');
  const start = Date.now();
  await stopChild(child, { graceMs: 100 });
  assert.ok(Date.now() - start < 3000);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('readiness fails promptly with a crashed child and its stderr', async () => {
  const output = [];
  const child = captureChild(spawn(process.execPath, ['-e', `console.error('fixture startup failed'); process.exit(23);`], { stdio: ['ignore', 'pipe', 'pipe'] }), output);
  const start = Date.now();
  await assert.rejects(waitForHealth('http://127.0.0.1:1/health', { child, output, timeoutMs: 5000, probeMs: 100 }), /exit=23[\s\S]*fixture startup failed/);
  assert.ok(Date.now() - start < 3000);
});

test('readiness reports an executable spawn failure instead of waiting for the deadline', async () => {
  const output = [];
  const child = captureChild(spawn(path.join(tmpdir(), 'relaylab-no-such-executable'), [], { stdio: ['ignore', 'pipe', 'pipe'] }), output);
  await assert.rejects(waitForHealth('http://127.0.0.1:1/health', { child, output, timeoutMs: 5000 }), /ENOENT/);
  await stopChild(child);
});

test('readiness retries a genuine HTTP error and accepts a subsequent healthy response', async () => {
  let probes = 0;
  const server = http.createServer((_request, response) => {
    probes++;
    response.writeHead(probes < 3 ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(probes < 3 ? { error: 'not ready' } : { status: 'ok' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await waitForHealth(`http://127.0.0.1:${server.address().port}/health`, { timeoutMs: 2000, probeMs: 100 });
    assert.ok(probes >= 3);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('a hanging health request cannot exceed the overall readiness budget', async () => {
  const server = http.createServer(() => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const start = Date.now();
  try {
    await assert.rejects(waitForHealth(`http://127.0.0.1:${server.address().port}/health`, { timeoutMs: 250, probeMs: 80 }), /health did not become ready[\s\S]*Last probe:/);
    assert.ok(Date.now() - start < 2000);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('stopped-runner observation retains transient deadline codes and requires terminal unavailable', async () => {
  const attempts = [{ outcome: 'timeout', rpcErrorCode: 4 }, { outcome: 'timeout', rpcErrorCode: 4 }, { outcome: 'unreachable', rpcErrorCode: 14 }];
  let count = 0;
  const result = await waitForUnreachable(async () => attempts[count++], { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(count, 3);
  assert.deepEqual(result, { outcome: 'unreachable', rpcErrorCode: 14 });
});

test('stopped-runner observation rejects success or incorrectly classified status codes', async () => {
  for (const result of [{ outcome: 'success', rpcErrorCode: null }, { outcome: 'timeout', rpcErrorCode: 14 }, { outcome: 'unreachable', rpcErrorCode: 4 }]) {
    await assert.rejects(waitForUnreachable(async () => result, { timeoutMs: 1000 }), /Unexpected stopped-runner response/);
  }
});

test('perpetual RPC timeouts cannot masquerade as an unavailable service', async () => {
  await assert.rejects(waitForUnreachable(async () => ({ outcome: 'timeout', rpcErrorCode: 4 }), { timeoutMs: 80, intervalMs: 10 }), /did not report unreachable\/code 14[\s\S]*timeout\/code 4/);
});

test('stopped-runner observation bounds and aborts a stalled HTTP probe', async () => {
  let signal;
  const start = Date.now();
  await assert.rejects(waitForUnreachable(async value => { signal = value; return new Promise(() => {}); }, { timeoutMs: 80 }), /did not report unreachable/);
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - start < 2000);
});
