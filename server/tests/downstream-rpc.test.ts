import { describe, expect, it } from "vitest";
import {
  buildDownstreamRpcRequest,
  classifyDownstreamRpcResponse,
} from "../src/downstream-rpc.js";

const experiment = {
  id: 42,
  name: "Healthy dependency",
  behavior: "healthy" as const,
  payload: { orderId: "ORDER-42" },
  createdAt: "2026-08-11T00:00:00.000Z",
};

describe("downstream RPC contract", () => {
  it("builds a versioned JSON-RPC request with a correlation id", () => {
    const request = buildDownstreamRpcRequest(experiment);

    expect(request).toMatchObject({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "relaylab.process.v1",
      params: {
        experimentId: 42,
        behavior: "healthy",
        payload: { orderId: "ORDER-42" },
      },
    });
  });

  it("accepts a correlated method result", () => {
    expect(
      classifyDownstreamRpcResponse(
        {
          jsonrpc: "2.0",
          id: "trace-1",
          result: {
            accepted: true,
            experimentId: 42,
            echo: { orderId: "ORDER-42" },
            processedAt: "2026-08-11T00:00:00.000Z",
          },
        },
        "trace-1",
      ),
    ).toBe("success");
  });

  it("classifies a correlated RPC error separately from HTTP transport", () => {
    expect(
      classifyDownstreamRpcResponse(
        {
          jsonrpc: "2.0",
          id: "trace-2",
          error: {
            code: -32001,
            message: "Dependency unavailable",
            data: { retryable: true },
          },
        },
        "trace-2",
      ),
    ).toBe("downstream_error");
  });

  it("rejects an otherwise valid envelope with the wrong correlation id", () => {
    expect(
      classifyDownstreamRpcResponse(
        {
          jsonrpc: "2.0",
          id: "wrong-trace",
          result: {
            accepted: true,
            experimentId: 42,
            echo: {},
            processedAt: "2026-08-11T00:00:00.000Z",
          },
        },
        "expected-trace",
      ),
    ).toBe("invalid_response");
  });
});
