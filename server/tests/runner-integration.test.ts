import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildHttpApplication } from "./http-application.js";
import { buildRunner } from "../../runner/src/app.js";
import SqliteDatabase from "better-sqlite3";
import { Server, ServerCredentials, type ServerUnaryCall, type sendUnaryData } from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { runnerDefinition, type ExecuteRunRequest, type Execution } from "../../protocol/runner.mjs";

let directory: string;
let runner: ReturnType<typeof buildRunner>;
let application: Awaited<ReturnType<typeof buildHttpApplication>>;
let runnerTarget: string;
let fakeRunner: Server | undefined;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "relaylab-grpc-integration-"));
  runner = buildRunner({ databasePath: path.join(directory, "execution.sqlite"), slowDelayMs: 150 });
  const port = await runner.bind("127.0.0.1:0");
  runnerTarget = `127.0.0.1:${port}`;
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), runnerTarget, timeoutMs: 5000, reviewDemoEnabled: true });
});
afterEach(async () => { await application?.close(); fakeRunner?.forceShutdown(); fakeRunner = undefined; await runner?.close(); await rm(directory, { recursive: true, force: true }); });

it("uses the gRPC execution as immutable review evidence across researcher and reviewer clients", async () => {
  const researcher = await request(application.app).post("/api/demo-sessions").send({ actorId: "researcher-a" }).expect(201);
  const reviewer = await request(application.app).post("/api/demo-sessions").send({ actorId: "reviewer" }).expect(201);
  const experiment = await request(application.app).post("/api/experiments").send({ name: "gRPC shared workflow", behavior: "healthy", payload: { sample: "grpc" } }).expect(201);
  const run = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`).expect(201);
  expect(run.body).toMatchObject({ outcome: "success", httpStatus: null, response: { transport: "grpc", execution: { state: "COMPLETED" } } });
  const review = await request(application.app).post(`/api/runs/${run.body.id}/reviews`).set("Authorization", `Bearer ${researcher.body.token}`).expect(201);
  const queue = await request(application.app).get("/api/reviews").set("Authorization", `Bearer ${reviewer.body.token}`).expect(200);
  expect(queue.body[0].run.response.execution.executionId).toBe(run.body.response.execution.executionId);
  await request(application.app).patch(`/api/reviews/${review.body.id}`).set("Authorization", `Bearer ${reviewer.body.token}`).send({ status: "approved", feedback: "Runner-owned execution verified." }).expect(200);
  const own = await request(application.app).get("/api/reviews").set("Authorization", `Bearer ${researcher.body.token}`).expect(200);
  expect(own.body[0].status).toBe("approved");
});

async function experiment(behavior = "healthy") {
  return (await request(application.app).post("/api/experiments").send({ name: "Runner behavior", behavior, payload: { sample: "grpc" } }).expect(201)).body;
}

it("records gRPC unavailable status, keeps the API usable, and recovers when the runner returns", async () => {
  const saved = await experiment();
  await runner.close();
  const attempt = await request(application.app).post(`/api/experiments/${saved.id}/runs`).set("Idempotency-Key", "retry-unavailable").expect(201);
  expect(attempt.body).toMatchObject({ outcome: "unreachable", rpcErrorCode: 14, response: { transport: "grpc", grpcStatus: 14 } });
  await request(application.app).get(`/api/runs/${attempt.body.id}/execution`).expect(503);
  await request(application.app).get("/api/experiments").expect(200);
  runner = buildRunner({ databasePath: path.join(directory, "execution.sqlite") });
  await runner.bind(runnerTarget);
  const neverAccepted = await request(application.app).get(`/api/runs/${attempt.body.id}/execution`).expect(404);
  expect(neverAccepted.body.error).toContain("may not have been accepted");
  const recovered = await request(application.app).post(`/api/experiments/${saved.id}/runs`).set("Idempotency-Key", "retry-unavailable").expect(201);
  expect(recovered.body.outcome).toBe("success");
  await request(application.app).get(`/api/runs/${attempt.body.id}/execution`).expect(200);
});

it("retains a deadline receipt while status inspection and a same-key retry recover one execution", async () => {
  const saved = await experiment("slow");
  await application.close();
  // Create a slow runner long enough to separate client startup from the deadline.
  await runner.close();
  runner = buildRunner({ databasePath: path.join(directory, "execution.sqlite"), slowDelayMs: 700 });
  await runner.bind(runnerTarget);
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), runnerTarget, timeoutMs: 300 });
  const healthy = await experiment();
  expect((await request(application.app).post(`/api/experiments/${healthy.id}/runs`).expect(201)).body.outcome).toBe("success");
  const timedOut = await request(application.app).post(`/api/experiments/${saved.id}/runs`).set("Idempotency-Key", "retry-deadline").expect(201);
  expect(timedOut.body).toMatchObject({ outcome: "timeout", rpcErrorCode: 4, response: { grpcStatus: 4 } });
  const live = await request(application.app).get(`/api/runs/${timedOut.body.id}/execution`).expect(200);
  expect(live.body.state).toBe("RUNNING");
  await application.close();
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), runnerTarget, timeoutMs: 5000 });
  const retry = await request(application.app).post(`/api/experiments/${saved.id}/runs`).set("Idempotency-Key", "retry-deadline").expect(201);
  expect(retry.body).toMatchObject({ outcome: "success", response: { execution: { executionId: live.body.executionId } } });
  const history = await request(application.app).get(`/api/experiments/${saved.id}`).expect(200);
  expect(history.body.runs.map((run: { outcome: string }) => run.outcome)).toEqual(["success", "timeout"]);
  const replay = await request(application.app).post(`/api/experiments/${saved.id}/runs`).set("Idempotency-Key", "retry-deadline").expect(200);
  expect(replay.body.id).toBe(retry.body.id);
});

it("classifies business failures and malformed execution evidence separately from transport failure", async () => {
  const failure = await experiment("unavailable");
  const failed = await request(application.app).post(`/api/experiments/${failure.id}/runs`).expect(201);
  expect(failed.body).toMatchObject({ outcome: "downstream_error", httpStatus: null, response: { grpcStatus: 0, execution: { outcome: "downstream_error" } } });
  const malformed = await experiment("malformed");
  expect((await request(application.app).post(`/api/experiments/${malformed.id}/runs`).expect(201)).body.outcome).toBe("invalid_response");
});

it("stores only coordinator receipts/reviews locally and preserves receipts across restart", async () => {
  const saved = await experiment();
  const result = await request(application.app).post(`/api/experiments/${saved.id}/runs`).expect(201);
  await application.close();
  const coordinator = new SqliteDatabase(path.join(directory, "coordinator.sqlite"), { readonly: true });
  expect(coordinator.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name").all()).toEqual([
    { name: "experiment_runs" }, { name: "experiments" }, { name: "run_reviews" },
  ]);
  coordinator.close();
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), runnerTarget, timeoutMs: 5000 });
  expect((await request(application.app).get(`/api/experiments/${saved.id}`).expect(200)).body.runs[0].id).toBe(result.body.id);
  await request(application.app).get(`/api/runs/${result.body.id}/execution`).expect(200);
});

it("rejects a mismatched execution identity or payload rather than persisting false success", async () => {
  await runner.close();
  fakeRunner = new Server();
  let mismatch = "operation";
  fakeRunner.addService(runnerDefinition, {
    executeRun(call: ServerUnaryCall<ExecuteRunRequest, Execution>, callback: sendUnaryData<Execution>) {
      const input = call.request;
      callback(null, {
        executionId: randomUUID(), operationId: mismatch === "operation" ? "different-operation" : input.operationId,
        experimentRef: mismatch === "experiment" ? "different-experiment" : input.experimentRef,
        state: "COMPLETED", outcome: "success",
        resultJson: JSON.stringify({ accepted: true, experimentRef: input.experimentRef, echo: mismatch === "payload" ? { sample: "wrong" } : JSON.parse(input.payloadJson), processedAt: new Date().toISOString() }),
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      });
    },
  });
  await new Promise<void>((resolve, reject) => fakeRunner!.bindAsync(runnerTarget, ServerCredentials.createInsecure(), (error) => error ? reject(error) : resolve()));
  for (const field of ["operation", "experiment", "payload"]) {
    mismatch = field;
    const saved = await experiment();
    const result = await request(application.app).post(`/api/experiments/${saved.id}/runs`).expect(201);
    expect(result.body.outcome).toBe("invalid_response");
  }
});

it("retains a legacy JSON-RPC receipt when the same coordinator database gains the gRPC lane", async () => {
  await application.close();
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), downstreamUrl: "http://127.0.0.1:1" });
  const saved = await experiment();
  const baseline = await request(application.app).post(`/api/experiments/${saved.id}/runs`).expect(201);
  expect(baseline.body).toMatchObject({ outcome: "unreachable", response: null });
  await application.close();
  application = await buildHttpApplication({ databasePath: path.join(directory, "coordinator.sqlite"), runnerTarget, timeoutMs: 5000 });
  const current = await request(application.app).post(`/api/experiments/${saved.id}/runs`).expect(201);
  expect(current.body.response.transport).toBe("grpc");
  const details = await request(application.app).get(`/api/experiments/${saved.id}`).expect(200);
  expect(details.body.runs[1]).toEqual(baseline.body);
});
