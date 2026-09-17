import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await application?.close();
    application = undefined;
    downstreamServer?.close();
    downstreamServer = undefined;

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
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
      }, 80);
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
    expect(run.body.durationMs).toBeGreaterThanOrEqual(15);
    expect(run.body.durationMs).toBeLessThan(80);
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
