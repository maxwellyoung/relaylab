import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicPort = process.env.PORT ?? "8080";
const downstreamPort = process.env.DOWNSTREAM_PORT ?? "3001";
const dataDirectory = process.env.RELAYLAB_DATA_DIR ?? "/data";

const children = [
  spawn(process.execPath, ["downstream/dist/server.js"], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      DOWNSTREAM_PORT: downstreamPort,
    },
    stdio: "inherit",
  }),
  spawn(process.execPath, ["server/dist/server.js"], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      PORT: publicPort,
      RELAYLAB_DATA_DIR: dataDirectory,
      DOWNSTREAM_URL: `http://127.0.0.1:${downstreamPort}`,
      CLIENT_DIST_DIR: path.join(rootDirectory, "client/dist"),
    },
    stdio: "inherit",
  }),
];

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `RelayLab child process exited unexpectedly (${signal ?? code ?? "unknown"}).`,
    );
    shutdown("SIGTERM");
    process.exitCode = code ?? 1;
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
