import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import SqliteDatabase from "better-sqlite3";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApplication } from "../src/app.js";
import { openDatabase } from "../src/database.js";

type RpcRequestBody = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: {
    experimentId: number;
    behavior: string;
    payload: Record<string, unknown>;
  };
};

async function readRpcRequest(incoming: IncomingMessage) {
  const body = await new Promise<string>((resolve) => {
    let value = "";
    incoming.on("data", (chunk) => {
      value += chunk.toString();
    });
    incoming.on("end", () => resolve(value));
  });
  return JSON.parse(body) as RpcRequestBody;
}

function writeRpcResult(
  outgoing: ServerResponse,
  requestBody: RpcRequestBody,
) {
  outgoing.writeHead(200, { "Content-Type": "application/json" });
  outgoing.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: requestBody.id,
      result: {
        accepted: true,
        experimentId: requestBody.params.experimentId,
        echo: requestBody.params.payload,
        processedAt: "2026-07-28T01:00:00.000Z",
      },
    }),
  );
}

describe("request experiments", () => {
  let application: ReturnType<typeof buildApplication> | undefined;
  let downstreamServer: Server | undefined;
  let downstreamProcess: ChildProcess | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await application?.close();
    application = undefined;
    downstreamServer?.close();
    downstreamServer = undefined;
    downstreamProcess?.kill("SIGKILL");
    downstreamProcess = undefined;

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("logs each distributed exchange with a correlation ID a reader can match", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      writeRpcResult(outgoing, await readRpcRequest(incoming));
    });
    await new Promise<void>((resolve) => downstreamServer?.listen(0, "127.0.0.1", resolve));
    const address = downstreamServer.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const lines: string[] = [];
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${address.port}`,
      log: (line) => lines.push(line),
    });

    const experiment = await request(application.app).post("/api/experiments").send({
      name: "Logged exchange", behavior: "healthy", payload: {},
    });
    const run = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`);
    await request(application.app).post("/api/experiments").send({ name: "", behavior: "explode" });

    const rpc = String(run.body.response.id).slice(0, 8);
    expect(lines).toEqual([
      `created experiment=${experiment.body.id} behavior=healthy`,
      `run experiment=${experiment.body.id} behavior=healthy -> relaylab.process.v1 rpc=${rpc}`,
      expect.stringMatching(new RegExp(`^reply rpc=${rpc} outcome=success http=200 \\d+ms$`)),
      `saved run=${run.body.id} experiment=${experiment.body.id} outcome=success`,
      "rejected experiment: invalid input (400)",
    ]);
  });

  it("reports coordinator health without touching the database workflow", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
    });

    const response = await request(application.app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "relaylab-coordinator",
    });
  });

  it("creates an experiment and lists it later", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
    });

    const created = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Slow dependency",
        behavior: "slow",
        payload: { orderId: "ORDER-42", quantity: 2 },
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.any(Number),
      name: "Slow dependency",
      behavior: "slow",
      payload: { orderId: "ORDER-42", quantity: 2 },
    });

    const listed = await request(application.app).get("/api/experiments");

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([created.body]);
  });

  it("runs a healthy experiment through JSON-RPC and persists the envelope", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      expect(incoming.url).toBe("/rpc");
      const requestBody = await readRpcRequest(incoming);
      expect(requestBody).toMatchObject({
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "relaylab.process.v1",
        params: {
          behavior: "healthy",
          payload: { orderId: "ORDER-7" },
        },
      });
      writeRpcResult(outgoing, requestBody);
    });
    await new Promise<void>((resolve) => {
      downstreamServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = downstreamServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Downstream test service did not bind to a TCP port");
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${address.port}`,
    });

    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Healthy checkout",
        behavior: "healthy",
        payload: { orderId: "ORDER-7" },
      });

    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      id: expect.any(Number),
      experimentId: experiment.body.id,
      outcome: "success",
      httpStatus: 200,
      durationMs: expect.any(Number),
      response: {
        jsonrpc: "2.0",
        id: expect.any(String),
        result: {
          accepted: true,
          experimentId: experiment.body.id,
          echo: { orderId: "ORDER-7" },
        },
      },
    });

    const details = await request(application.app).get(
      `/api/experiments/${experiment.body.id}`,
    );

    expect(details.status).toBe(200);
    expect(details.body).toMatchObject({
      ...experiment.body,
      runs: [run.body],
    });
  });

  it("records a correlated JSON-RPC application error as durable evidence", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      const requestBody = await readRpcRequest(incoming);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestBody.id,
          error: {
            code: -32001,
            message: "Dependency unavailable",
            data: { retryable: true },
          },
        }),
      );
    });
    await new Promise<void>((resolve) => {
      downstreamServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = downstreamServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Downstream test service did not bind to a TCP port");
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${address.port}`,
    });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Unavailable inventory",
        behavior: "unavailable",
        payload: { orderId: "ORDER-8" },
      });

    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      experimentId: experiment.body.id,
      outcome: "downstream_error",
      httpStatus: 200,
      // The method's error code is queryable, not only buried in the envelope.
      rpcErrorCode: -32001,
      response: {
        jsonrpc: "2.0",
        id: expect.any(String),
        error: {
          code: -32001,
          message: "Dependency unavailable",
          data: { retryable: true },
        },
      },
    });
  });

  it("records an invalid RPC method result as contract-failure evidence", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      const requestBody = await readRpcRequest(incoming);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestBody.id,
          result: "upstream said maybe",
        }),
      );
    });
    await new Promise<void>((resolve) => {
      downstreamServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = downstreamServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Downstream test service did not bind to a TCP port");
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${address.port}`,
    });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Malformed success",
        behavior: "malformed",
        payload: { orderId: "ORDER-9" },
      });

    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      outcome: "invalid_response",
      httpStatus: 200,
      response: {
        jsonrpc: "2.0",
        id: expect.any(String),
        result: "upstream said maybe",
      },
    });
  });

  it("aborts a slow dependency and persists a timeout outcome", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      const requestBody = await readRpcRequest(incoming);
      setTimeout(() => {
        writeRpcResult(outgoing, requestBody);
      }, 1_500).unref();
    });
    await new Promise<void>((resolve) => {
      downstreamServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = downstreamServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Downstream test service did not bind to a TCP port");
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: 20,
    });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Slow inventory",
        behavior: "slow",
        payload: { orderId: "ORDER-10" },
      });

    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      outcome: "timeout",
      httpStatus: null,
      response: null,
    });
    // The reply arrives after 1.5 s; a slow machine must not turn the abort into a flaky failure.
    expect(run.body.durationMs).toBeGreaterThanOrEqual(15);
    expect(run.body.durationMs).toBeLessThan(1_000);
  });

  it("records an unreachable downstream instead of crashing the API", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: "http://127.0.0.1:1",
      timeoutMs: 50,
    });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Disconnected dependency",
        behavior: "healthy",
        payload: { orderId: "ORDER-11" },
      });

    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      outcome: "unreachable",
      httpStatus: null,
      response: null,
    });
  });

  it("records unreachable when a live downstream process is killed mid-session", async () => {
    // A real child process, not an unused port: the dependency dies between runs.
    const reserved = createServer();
    await new Promise<void>((resolve) => reserved.listen(0, "127.0.0.1", resolve));
    const reservedAddress = reserved.address();
    if (!reservedAddress || typeof reservedAddress === "string") {
      throw new Error("Could not reserve a port");
    }
    const { port } = reservedAddress;
    await new Promise<void>((resolve, reject) =>
      reserved.close((error) => (error ? reject(error) : resolve())));

    const source = `require("http").createServer((incoming, outgoing) => {
      let body = "";
      incoming.on("data", (chunk) => { body += chunk; });
      incoming.on("end", () => {
        const request = JSON.parse(body);
        outgoing.writeHead(200, { "Content-Type": "application/json" });
        outgoing.end(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            accepted: true,
            experimentId: request.params.experimentId,
            echo: request.params.payload,
            processedAt: new Date().toISOString(),
          },
        }));
      });
    }).listen(${port}, "127.0.0.1");`;
    downstreamProcess = spawn(process.execPath, ["-e", source], { stdio: "ignore" });

    const reachable = async () => new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" })
        .on("connect", () => { socket.end(); resolve(true); })
        .on("error", () => resolve(false));
    });
    for (let attempt = 0; attempt < 100 && !(await reachable()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
      downstreamUrl: `http://127.0.0.1:${port}`,
    });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({ name: "Dependency that dies", behavior: "healthy", payload: { orderId: "ORDER-77" } });

    const before = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`);
    expect(before.body).toMatchObject({ outcome: "success", httpStatus: 200 });

    downstreamProcess.kill("SIGKILL");
    for (let attempt = 0; attempt < 100 && (await reachable()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const after = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`);
    expect(after.status).toBe(201);
    expect(after.body).toMatchObject({ outcome: "unreachable", httpStatus: null, response: null });

    // The coordinator kept serving and both attempts are durable evidence.
    const details = await request(application.app).get(`/api/experiments/${experiment.body.id}`);
    expect(details.body.runs.map((run: { outcome: string }) => run.outcome))
      .toEqual(["unreachable", "success"]);
  });

  it("rejects an unknown downstream behavior with a controlled error", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
    });

    const response = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Mystery dependency",
        behavior: "sometimes",
        payload: {},
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "Invalid experiment",
      details: {
        behavior: expect.any(Array),
      },
    });
  });

  it("rejects malformed JSON as client input and keeps the API usable", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
    });

    const response = await request(application.app)
      .post("/api/experiments")
      .set("Content-Type", "application/json")
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid JSON body" });
    const listed = await request(application.app).get("/api/experiments");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([]);
  });

  it("does not turn a failed run write into invented unreachable evidence", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      writeRpcResult(outgoing, await readRpcRequest(incoming));
    });
    await new Promise<void>((resolve) => downstreamServer?.listen(0, "127.0.0.1", resolve));
    const address = downstreamServer.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const databasePath = path.join(temporaryDirectory, "relaylab.sqlite");
    const database = openDatabase(databasePath);
    const write = vi.spyOn(database, "createRun").mockRejectedValueOnce(new Error("Temporary write failure"));
    application = buildApplication({ databasePath, database, downstreamUrl: `http://127.0.0.1:${address.port}` });
    const experiment = await request(application.app).post("/api/experiments").send({
      name: "Healthy service, failed storage", behavior: "healthy", payload: {},
    });
    const run = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`);
    expect(run.status).toBe(503);
    expect(write).toHaveBeenCalledTimes(1);
    const details = await request(application.app).get(`/api/experiments/${experiment.body.id}`);
    expect(details.body.runs).toEqual([]);
  });

  it("returns a controlled error when a missing experiment is run", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "relaylab.sqlite"),
    });

    const response = await request(application.app).post(
      "/api/experiments/999/runs",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Experiment not found" });
  });

  it("keeps a database created before rpc_error_code existed, and adds the column", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const databasePath = path.join(temporaryDirectory, "relaylab.sqlite");

    // The schema as it shipped before the column was introduced.
    const legacy = new SqliteDatabase(databasePath);
    legacy.exec(`
      CREATE TABLE experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        behavior TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE experiment_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        http_status INTEGER,
        duration_ms INTEGER NOT NULL,
        response_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
      );
      INSERT INTO experiments (name, behavior, payload_json)
        VALUES ('Older experiment', 'healthy', '{"orderId":"OLD-1"}');
      INSERT INTO experiment_runs (experiment_id, outcome, http_status, duration_ms, response_json)
        VALUES (1, 'success', 200, 12, '{"jsonrpc":"2.0"}');
    `);
    legacy.close();

    const database = openDatabase(databasePath);
    const experiment = await database.getExperiment(1);
    expect(experiment?.name).toBe("Older experiment");
    expect(experiment?.runs).toHaveLength(1);
    expect(experiment?.runs[0]?.rpcErrorCode).toBeNull();

    const run = await database.createRun({
      experimentId: 1,
      outcome: "downstream_error",
      httpStatus: 200,
      rpcErrorCode: -32001,
      durationMs: 5,
      response: { jsonrpc: "2.0" },
    });
    expect(run.rpcErrorCode).toBe(-32001);
    await database.close();
  });

  it("lets the database reject an unsupported behaviour or outcome", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const databasePath = path.join(temporaryDirectory, "relaylab.sqlite");
    const database = openDatabase(databasePath);
    await database.close();

    const direct = new SqliteDatabase(databasePath);
    try {
      expect(() => direct
        .prepare("INSERT INTO experiments (name, behavior, payload_json) VALUES (?, ?, ?)")
        .run("Bad behaviour", "teleport", "{}")).toThrow(/CHECK constraint/);
      direct.prepare("INSERT INTO experiments (name, behavior, payload_json) VALUES (?, ?, ?)")
        .run("Good behaviour", "healthy", "{}");
      expect(() => direct
        .prepare("INSERT INTO experiment_runs (experiment_id, outcome, duration_ms) VALUES (?, ?, ?)")
        .run(1, "exploded", 1)).toThrow(/CHECK constraint/);
    } finally {
      direct.close();
    }
  });

  it("answers malformed experiment identifiers with 404 without querying the database", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const databasePath = path.join(temporaryDirectory, "relaylab.sqlite");
    const database = openDatabase(databasePath);
    const lookup = vi.spyOn(database, "getExperiment");
    application = buildApplication({ databasePath, database });

    for (const identifier of ["abc", "0", "-1", "1.5", "1e3"]) {
      const read = await request(application.app).get(`/api/experiments/${identifier}`);
      const run = await request(application.app).post(`/api/experiments/${identifier}/runs`);
      expect(read.status).toBe(404);
      expect(run.status).toBe(404);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("retains experiments and run evidence after an application restart", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      const requestBody = await readRpcRequest(incoming);
      writeRpcResult(outgoing, requestBody);
    });
    await new Promise<void>((resolve) => {
      downstreamServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = downstreamServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Downstream test service did not bind to a TCP port");
    }

    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relaylab-test-"));
    const databasePath = path.join(temporaryDirectory, "relaylab.sqlite");
    const downstreamUrl = `http://127.0.0.1:${address.port}`;
    application = buildApplication({ databasePath, downstreamUrl });
    const experiment = await request(application.app)
      .post("/api/experiments")
      .send({
        name: "Persistent checkout",
        behavior: "healthy",
        payload: { orderId: "ORDER-12" },
      });
    const run = await request(application.app).post(
      `/api/experiments/${experiment.body.id}/runs`,
    );

    await application.close();
    application = buildApplication({ databasePath, downstreamUrl });
    const details = await request(application.app).get(
      `/api/experiments/${experiment.body.id}`,
    );

    expect(details.status).toBe(200);
    expect(details.body).toMatchObject({
      ...experiment.body,
      runs: [run.body],
    });
  });
});
