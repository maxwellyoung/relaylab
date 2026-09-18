import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDownstreamService } from "../src/app.js";

const rpcRequest = (
  params: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  jsonrpc: "2.0",
  id: "trace-7",
  method: "relaylab.process.v1",
  params,
  ...overrides,
});

describe("downstream JSON-RPC service", () => {
  it("logs each received call and its reply against the caller's correlation ID", async () => {
    const lines: string[] = [];
    const service = buildDownstreamService({ log: (line) => lines.push(line) });

    await request(service)
      .post("/rpc")
      .send(rpcRequest({ experimentId: 7, behavior: "unavailable", payload: {} }));

    expect(lines).toEqual([
      "received relaylab.process.v1 rpc=trace-7 experiment=7 behavior=unavailable",
      "replied rpc=trace-7 error=-32001",
    ]);
  });

  it("reports downstream health independently", async () => {
    const service = buildDownstreamService();

    const response = await request(service).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "relaylab-downstream",
    });
  });

  it("returns a correlated result for a healthy RPC request", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .send(
        rpcRequest({
          experimentId: 7,
          behavior: "healthy",
          payload: { orderId: "ORDER-42", quantity: 2 },
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jsonrpc: "2.0",
      id: "trace-7",
      result: {
        accepted: true,
        experimentId: 7,
        echo: { orderId: "ORDER-42", quantity: 2 },
        processedAt: expect.any(String),
      },
    });
  });

  it("returns a JSON-RPC application error when unavailable", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .send(
        rpcRequest({
          experimentId: 8,
          behavior: "unavailable",
          payload: { orderId: "ORDER-43" },
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: "trace-7",
      error: {
        code: -32001,
        message: "Dependency unavailable",
        data: { retryable: true },
      },
    });
  });

  it("can delay an RPC result to make timeout handling reproducible", async () => {
    const service = buildDownstreamService({ slowDelayMs: 25 });
    const startedAt = performance.now();

    const response = await request(service)
      .post("/rpc")
      .send(
        rpcRequest({
          experimentId: 9,
          behavior: "slow",
          payload: { orderId: "ORDER-44" },
        }),
      );

    expect(response.status).toBe(200);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(response.body).toMatchObject({
      jsonrpc: "2.0",
      id: "trace-7",
      result: {
        accepted: true,
        experimentId: 9,
        echo: { orderId: "ORDER-44" },
      },
    });
  });

  it("can return an invalid method result for contract checks", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .send(
        rpcRequest({
          experimentId: 10,
          behavior: "malformed",
          payload: { orderId: "ORDER-45" },
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: "trace-7",
      result: "upstream said maybe",
    });
  });

  it("uses the standard method-not-found error", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .send(
        rpcRequest(
          { experimentId: 11, behavior: "healthy", payload: {} },
          { method: "relaylab.missing.v1" },
        ),
      );

    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: "trace-7",
      error: {
        code: -32601,
        message: "Method not found",
        data: { method: "relaylab.missing.v1" },
      },
    });
  });

  it("uses the standard invalid-params error", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .send(rpcRequest({ behavior: "healthy", payload: {} }));

    expect(response.body).toMatchObject({
      jsonrpc: "2.0",
      id: "trace-7",
      error: {
        code: -32602,
        message: "Invalid params",
      },
    });
  });

  it("answers an unreadable envelope with a JSON-RPC parse error", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/rpc")
      .set("Content-Type", "application/json")
      .send('{"jsonrpc":');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});
