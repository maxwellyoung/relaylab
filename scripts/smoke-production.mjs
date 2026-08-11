import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  invariant(address && typeof address !== "string", "Unable to reserve a port");
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function startApplication({ dataDirectory, publicPort, downstreamPort }) {
  const output = [];
  const child = spawn(process.execPath, ["scripts/start-production.mjs"], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(publicPort),
      DOWNSTREAM_PORT: String(downstreamPort),
      RELAYLAB_DATA_DIR: dataDirectory,
      RELAYLAB_DATABASE_DRIVER: "sqlite",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output.push(chunk);
      if (output.length > 40) output.shift();
    });
  }
  return { child, output };
}

async function stopApplication(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

async function waitForHealth(baseUrl, application) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (application.child.exitCode !== null) {
      throw new Error(`Production process exited early:\n${application.output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be binding its ports.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production health check timed out:\n${application.output.join("")}`);
}

async function jsonRequest(baseUrl, pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json();
  invariant(response.ok, `${pathname} returned HTTP ${response.status}`);
  return body;
}

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "relaylab-smoke-"));
const publicPort = await availablePort();
const downstreamPort = await availablePort();
const baseUrl = `http://127.0.0.1:${publicPort}`;
let application;

try {
  application = startApplication({ dataDirectory, publicPort, downstreamPort });
  await waitForHealth(baseUrl, application);

  const experiment = await jsonRequest(baseUrl, "/api/experiments", {
    method: "POST",
    body: JSON.stringify({
      name: "Built production smoke",
      behavior: "healthy",
      payload: { orderId: "SMOKE-1", quantity: 1 },
    }),
  });
  invariant(Number.isInteger(experiment.id), "Created experiment has no numeric id");

  const run = await jsonRequest(
    baseUrl,
    `/api/experiments/${experiment.id}/runs`,
    { method: "POST" },
  );
  invariant(run.outcome === "success", `Unexpected run outcome: ${run.outcome}`);
  invariant(run.httpStatus === 200, `Unexpected downstream status: ${run.httpStatus}`);

  await stopApplication(application.child);
  application = startApplication({ dataDirectory, publicPort, downstreamPort });
  await waitForHealth(baseUrl, application);

  const persisted = await jsonRequest(
    baseUrl,
    `/api/experiments/${experiment.id}`,
  );
  invariant(persisted.id === experiment.id, "Experiment did not survive restart");
  invariant(persisted.runs?.length === 1, "Run history did not survive restart");
  invariant(persisted.runs[0].outcome === "success", "Persisted run changed outcome");

  console.log(
    `RelayLab production smoke passed: experiment ${experiment.id}, run ${run.id}, restart persistence verified.`,
  );
} finally {
  if (application) await stopApplication(application.child);
  await rm(dataDirectory, { recursive: true, force: true });
}
