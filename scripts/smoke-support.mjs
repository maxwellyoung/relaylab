import { setTimeout as delay } from 'node:timers/promises';

export function captureChild(child, output) {
  child.on('error', error => { child.smokeSpawnError = error; output.push(error.message); });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => {
    output.push(data.toString());
    if (output.length > 200) output.shift();
  });
  return child;
}

// SIGTERM is abrupt on Windows. Owned Node fixtures understand this IPC
// request and can flush their store and send gRPC shutdown before exiting.
// Non-IPC processes still use their normal termination signal. Every path has
// a force-stop bound; an unresponsive fixture cannot hang the test teardown.
export async function stopChild(child, { graceMs = 3000 } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let forceTimer;
    const finish = error => {
      clearTimeout(graceTimer); clearTimeout(forceTimer);
      child.off('exit', exited);
      error ? reject(error) : resolve();
    };
    const exited = () => finish();
    child.once('exit', exited);
    const graceTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (error) { finish(error); return; }
      forceTimer = setTimeout(() => finish(new Error(`Owned child ${child.pid} did not exit after force-stop`)), 2000);
    }, graceMs);
    const signal = () => {
      if (child.exitCode !== null || child.signalCode !== null) { finish(); return; }
      try { child.kill('SIGTERM'); } catch (error) { finish(error); }
    };
    if (child.connected) {
      try { child.send({ type: 'relaylab-shutdown' }, error => { if (error) signal(); }); }
      catch { signal(); }
    } else signal();
  });
}

export async function waitForHealth(url, {
  child, output = [], timeoutMs = 30000, probeMs = 750,
  label = 'health did not become ready', accept = body => body.status === 'ok',
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  const failed = () => child && (child.smokeSpawnError || child.exitCode !== null || child.signalCode !== null);
  const diagnostic = reason => new Error(`${label}: ${reason}\nChild: pid=${child?.pid ?? 'none'} exit=${child?.exitCode ?? 'none'} signal=${child?.signalCode ?? 'none'}${child?.smokeSpawnError ? ` spawn=${child.smokeSpawnError.message}` : ''}\nLast probe: ${last}\n${output.join('')}`);
  while (Date.now() < deadline) {
    if (failed()) throw diagnostic('process exited before readiness');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(probeMs, deadline - Date.now()))) });
      const text = await response.text();
      last = `HTTP ${response.status}: ${text.slice(0, 250)}`;
      if (response.ok && accept(JSON.parse(text))) return;
    } catch (error) { last = `${error.name}: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`; }
    if (failed()) throw diagnostic('process exited before readiness');
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(50, remaining));
  }
  throw diagnostic(`readiness budget ${timeoutMs}ms expired`);
}

// A stopped runner and a 300 ms RPC deadline are different observations.
// Some TCP stacks report the closed service after an in-flight RPC has already
// exceeded its deadline. Retain every real deadline classification and require
// a genuine code-14 response within a separate bounded observation window.
export async function waitForUnreachable(probe, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const controller = new AbortController();
  let last = 'no attempt';
  let rejectBudget;
  const budget = new Promise((_, reject) => { rejectBudget = reject; });
  const timer = setTimeout(() => {
    const error = new Error(`Runner did not report unreachable/code 14 within ${timeoutMs}ms; last: ${last}`);
    controller.abort(error); rejectBudget(error);
  }, timeoutMs);
  try {
    while (true) {
      const result = await Promise.race([probe(controller.signal), budget]);
      last = `${result.outcome}/code ${result.rpcErrorCode}`;
      if (result.outcome === 'unreachable' && result.rpcErrorCode === 14) return result;
      if (result.outcome !== 'timeout' || result.rpcErrorCode !== 4) {
        throw new Error(`Unexpected stopped-runner response: ${last}`);
      }
      await Promise.race([delay(intervalMs), budget]);
    }
  } finally { clearTimeout(timer); }
}
