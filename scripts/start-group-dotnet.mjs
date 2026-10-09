import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dotnetCommand } from './dotnet-command.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dll = path.join(root, 'coordinator-dotnet/bin/Release/net10.0/RelayLab.Coordinator.dll');
if (!existsSync(dll)) throw new Error('Build the group lane first with npm run build:group.');
const directory = process.env.RELAYLAB_GROUP_DATA_DIR ?? path.join(root, 'data/group');
const port = process.env.PORT ?? '3000';
const runnerPort = process.env.RUNNER_PORT ?? '50051';
const children = [];
let stopping = false;
let coordinatorStarted = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
}
function track(child, isRunner = false) {
  children.push(child);
  child.on('error', () => { console.error('Group process failed to start; check Node and .NET prerequisites.'); process.exitCode = 1; stop(); });
  child.on('exit', code => {
    if (stopping) return;
    if (isRunner && coordinatorStarted) {
      console.error('Runner exited; the coordinator remains available and records runner-unavailable attempts.');
      process.send?.({ type: 'runner-exit', pid: child.pid }); return;
    }
    process.exitCode = code || 1; stop();
  });
  return child;
}
const runner = track(spawn(process.execPath, ['runner/dist/server.js'], { cwd: root, env: { ...process.env, RUNNER_PORT: runnerPort, RUNNER_DATA_DIR: path.join(directory, 'runner') }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }), true);
runner.on('message', message => {
  if (stopping || coordinatorStarted || message?.type !== 'runner-ready') return;
  coordinatorStarted = true;
  process.send?.({ type: 'runner-ready', pid: runner.pid, port: Number(runnerPort) });
  const coordinator = track(spawn(dotnetCommand(), [dll], { cwd: root,
    env: { ...process.env, PORT: port, RELAYLAB_DATA_DIR: path.join(directory, 'coordinator'), RELAYLAB_REVIEW_DEMO: 'true', RELAYLAB_RUNNER_TARGET: `127.0.0.1:${runnerPort}`, CLIENT_DIST_DIR: path.join(root, 'client/dist'), DOTNET_CLI_TELEMETRY_OPTOUT: '1' }, stdio: ['inherit', 'pipe', 'inherit'] }));
  let buffer = '';
  let ready = false;
  coordinator.stdout.on('data', data => {
    process.stdout.write(data);
    buffer = (buffer + data.toString()).slice(-4096);
    if (!ready && buffer.includes('relaylab-coordinator-ready:' + port)) {
      ready = true; process.send?.({ type: 'coordinator-ready', pid: coordinator.pid, port: Number(port) });
    }
  });
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
