import { credentials, status } from "@grpc/grpc-js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RunnerClient, type Execution, type ExecuteRunRequest } from "../../protocol/runner.mjs";
import { buildRunner } from "../src/app.js";
import SqliteDatabase from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

let directory: string;
let runner: ReturnType<typeof buildRunner>;
let client: RunnerClient;
let child: ChildProcess | undefined;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "relaylab-runner-"));
  runner = buildRunner({ databasePath: path.join(directory, "runner.sqlite"), slowDelayMs: 80 });
  const port = await runner.bind("127.0.0.1:0");
  client = new RunnerClient(`127.0.0.1:${port}`, credentials.createInsecure());
});
afterEach(async () => {
  client?.close();
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  child = undefined;
  await runner?.close(); await rm(directory, { recursive: true, force: true });
});

function input(overrides: Partial<ExecuteRunRequest> = {}): ExecuteRunRequest {
  return { operationId: randomUUID(), correlationId: randomUUID(), experimentRef: "experiment-7", behavior: "healthy", payloadJson: JSON.stringify({ sample: "runner" }), ...overrides };
}
function execute(value: ExecuteRunRequest, deadlineMs = 5000): Promise<Execution> {
  return new Promise((resolve, reject) => client.executeRun(value, { deadline: Date.now() + deadlineMs }, (error, reply) => error ? reject(error) : resolve(reply!)));
}
function get(operationId: string): Promise<Execution> {
  return new Promise((resolve, reject) => client.getExecution({ operationId }, { deadline: Date.now() + 5000 }, (error, reply) => error ? reject(error) : resolve(reply!)));
}

it("executes a real protobuf call and returns the runner-owned persisted result", async () => {
  const request = input();
  const reply = await execute(request);
  expect(reply).toMatchObject({ operationId: request.operationId, experimentRef: "experiment-7", state: "COMPLETED", outcome: "success" });
  expect(JSON.parse(reply.resultJson)).toMatchObject({ accepted: true, echo: { sample: "runner" } });
  expect(await get(request.operationId)).toEqual(reply);
});

it("replays the same execution after a runner restart and rejects a changed request under its operation ID", async () => {
  const request = input({ payloadJson: '{"b":2,"a":1}' });
  const first = await execute(request);
  client.close();
  await runner.close();
  runner = buildRunner({ databasePath: path.join(directory, "runner.sqlite") });
  client = new RunnerClient(`127.0.0.1:${await runner.bind("127.0.0.1:0")}`, credentials.createInsecure());
  const replay = await execute({ ...request, correlationId: randomUUID(), payloadJson: '{"a":1,"b":2}' });
  expect(replay).toEqual(first);
  await expect(execute({ ...request, payloadJson: '{"a":99}' })).rejects.toMatchObject({ code: status.ALREADY_EXISTS });
});

it("lets a timed-out accepted job finish once and recovers it through GetExecution and retry", async () => {
  const request = input({ behavior: "slow" });
  // Warm the channel so this deadline measures accepted work, not connection startup.
  await execute(input());
  await expect(execute(request, 20)).rejects.toMatchObject({ code: status.DEADLINE_EXCEEDED });
  const running = await get(request.operationId);
  expect(running.state).toBe("RUNNING");
  const [firstRetry, secondRetry] = await Promise.all([execute(request), execute(request)]);
  expect(firstRetry.executionId).toBe(running.executionId);
  expect(secondRetry).toEqual(firstRetry);
  expect((await get(request.operationId)).state).toBe("COMPLETED");
});

it("refuses to re-execute a recovered interrupted ledger row", async () => {
  const request = input({ behavior: "slow" });
  const first = await execute(input());
  client.close();
  await runner.close();
  // Represents the durable RUNNING row left by an abrupt exit, distinct from
  // graceful shutdown which finishes accepted jobs before closing the store.
  const database = new SqliteDatabase(path.join(directory, "runner.sqlite"));
  database.prepare("UPDATE executions SET state = 'RUNNING', completed_at = '' WHERE operation_id = ?").run(first.operationId);
  database.close();
  runner = buildRunner({ databasePath: path.join(directory, "runner.sqlite") });
  client = new RunnerClient(`127.0.0.1:${await runner.bind("127.0.0.1:0")}`, credentials.createInsecure());
  expect((await get(first.operationId)).state).toBe("INTERRUPTED");
  await expect(execute({ ...request, operationId: first.operationId })).rejects.toMatchObject({ code: status.ALREADY_EXISTS });
  // Same original content is refused as uncertain, rather than run twice.
  await expect(execute({ ...input(), operationId: first.operationId })).rejects.toMatchObject({ code: status.ABORTED });
});

it("recovers an actual abruptly killed runner process without silently re-executing its accepted job", async () => {
  client.close(); await runner.close();
  async function launch() {
    child = spawn(process.execPath, ["--import", "tsx", "runner/src/server.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, RUNNER_PORT: "0", RUNNER_DATA_DIR: directory, RUNNER_SLOW_DELAY_MS: "2000" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Runner process readiness timed out")), 5000);
      child!.on("message", (message: { type?: string; port?: number }) => {
        if (message.type === "runner-ready" && message.port) { clearTimeout(timer); resolve(message.port); }
      });
      child!.once("exit", () => { clearTimeout(timer); reject(new Error("Runner process exited before readiness")); });
    });
    client = new RunnerClient(`127.0.0.1:${port}`, credentials.createInsecure());
  }
  await launch();
  await execute(input());
  const request = input({ behavior: "slow" });
  await expect(execute(request, 100)).rejects.toMatchObject({ code: status.DEADLINE_EXCEEDED });
  expect((await get(request.operationId)).state).toBe("RUNNING");
  const exited = once(child!, "exit"); child!.kill("SIGKILL"); await exited; client.close();
  await launch();
  expect((await get(request.operationId)).state).toBe("INTERRUPTED");
  await expect(execute(request)).rejects.toMatchObject({ code: status.ABORTED });
});

it("rejects invalid payloads and exposes missing-operation errors through real gRPC", async () => {
  await expect(execute(input({ payloadJson: "null" }))).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
  await expect(execute(input({ behavior: "unknown" }))).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
  await expect(execute(input({ correlationId: "not-a-uuid" }))).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
  await expect(get("missing")).rejects.toMatchObject({ code: status.NOT_FOUND });
});

it("refuses a competing owner before it can mark a live execution interrupted", async () => {
  await execute(input());
  const request = input({ behavior: "slow" });
  const pending = execute(request);
  expect((await get(request.operationId)).state).toBe("RUNNING");
  expect(() => buildRunner({ databasePath: path.join(directory, "runner.sqlite") })).toThrow("already owned");
  expect((await get(request.operationId)).state).toBe("RUNNING");
  expect((await pending).state).toBe("COMPLETED");
});
