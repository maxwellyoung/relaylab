import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = process.env.RELAYLAB_GROUP_DATA_DIR ?? path.join(root, "data", "group");
const runnerPort = process.env.RUNNER_PORT ?? "50051";
const children = [];
let stopping = false;
function start(file, env, isRunner = false) {
  const child = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: ["inherit", "inherit", "inherit", "ipc"] });
  children.push(child);
  child.on("error", () => { process.exitCode = 1; stop(); });
  child.on("exit", (code) => {
    if (stopping) return;
    if (isRunner && coordinatorStarted) {
      console.error("Runner exited; the coordinator remains available and will record runner-unavailable attempts. Restart the runner with its existing data directory.");
      process.send?.({ type: "runner-exit", pid: child.pid });
      return;
    }
    process.exitCode = code || 1; stop();
  });
  return child;
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
let coordinatorStarted = false;
const runner = start("runner/dist/server.js", { RUNNER_PORT: runnerPort, RUNNER_DATA_DIR: path.join(directory, "runner") }, true);
runner.on("message", (message) => {
  if (stopping || coordinatorStarted || message?.type !== "runner-ready") return;
  coordinatorStarted = true;
  process.send?.({ type: "runner-ready", pid: runner.pid, port: Number(runnerPort) });
  const coordinator = start("server/dist/server.js", {
    PORT: process.env.PORT ?? "3000", RELAYLAB_DATA_DIR: path.join(directory, "coordinator"),
    RELAYLAB_DATABASE_DRIVER: "sqlite", RELAYLAB_REVIEW_DEMO: "true",
    RELAYLAB_RUNNER_TARGET: `127.0.0.1:${runnerPort}`,
    CLIENT_DIST_DIR: path.join(root, "client", "dist"),
  });
  coordinator.on("message", (value) => {
    if (value?.type === "coordinator-ready") process.send?.({ type: "coordinator-ready", pid: coordinator.pid, port: value.port });
  });
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
