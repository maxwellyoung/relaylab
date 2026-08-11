import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "../src/app.js";

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

  it("runs a healthy experiment through HTTP and persists the evidence", async () => {
    downstreamServer = createServer(async (incoming, outgoing) => {
      const body = await new Promise<string>((resolve) => {
        let value = "";
        incoming.on("data", (chunk) => {
          value += chunk.toString();
        });
        incoming.on("end", () => resolve(value));
      });
      const requestBody = JSON.parse(body) as {
        experimentId: number;
        payload: Record<string, unknown>;
      };

      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          accepted: true,
          experimentId: requestBody.experimentId,
          echo: requestBody.payload,
          processedAt: "2026-07-28T01:00:00.000Z",
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
        accepted: true,
        experimentId: experiment.body.id,
        echo: { orderId: "ORDER-7" },
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

  it("records a downstream 503 as durable failure evidence", async () => {
    downstreamServer = createServer((_incoming, outgoing) => {
      outgoing.writeHead(503, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          error: "Simulated downstream outage",
          retryable: true,
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
      httpStatus: 503,
      response: {
        error: "Simulated downstream outage",
        retryable: true,
      },
    });
  });

  it("records a malformed success body as invalid response evidence", async () => {
    downstreamServer = createServer((_incoming, outgoing) => {
      outgoing.writeHead(200, { "Content-Type": "text/plain" });
      outgoing.end("upstream said maybe");
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
      response: "upstream said maybe",
    });
  });

  it("aborts a slow dependency and persists a timeout outcome", async () => {
    downstreamServer = createServer((_incoming, outgoing) => {
      setTimeout(() => {
        outgoing.writeHead(200, { "Content-Type": "application/json" });
        outgoing.end(
          JSON.stringify({
            accepted: true,
            experimentId: 1,
            echo: {},
            processedAt: "2026-07-28T01:00:00.000Z",
          }),
        );
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
      const body = await new Promise<string>((resolve) => {
        let value = "";
        incoming.on("data", (chunk) => {
          value += chunk.toString();
        });
        incoming.on("end", () => resolve(value));
      });
      const requestBody = JSON.parse(body) as {
        experimentId: number;
        payload: Record<string, unknown>;
      };
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          accepted: true,
          experimentId: requestBody.experimentId,
          echo: requestBody.payload,
          processedAt: "2026-07-28T01:00:00.000Z",
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
