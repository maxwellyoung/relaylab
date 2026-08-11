import express from "express";
import { z } from "zod";

const processRequest = z.object({
  experimentId: z.number().int().positive(),
  behavior: z.enum(["healthy", "slow", "unavailable", "malformed"]),
  payload: z.record(z.string(), z.unknown()),
});

const rpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown(),
});

const RPC_METHOD = "relaylab.process.v1";

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  };
}

export function buildDownstreamService({
  slowDelayMs = 800,
}: {
  slowDelayMs?: number;
} = {}) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "relaylab-downstream" });
  });

  app.post("/rpc", async (request, response) => {
    const envelope = rpcRequest.safeParse(request.body);
    if (!envelope.success) {
      response.json(rpcError(null, -32600, "Invalid Request"));
      return;
    }

    if (envelope.data.method !== RPC_METHOD) {
      response.json(
        rpcError(envelope.data.id, -32601, "Method not found", {
          method: envelope.data.method,
        }),
      );
      return;
    }

    const parsed = processRequest.safeParse(envelope.data.params);
    if (!parsed.success) {
      response.json(
        rpcError(envelope.data.id, -32602, "Invalid params", {
          fields: parsed.error.flatten().fieldErrors,
        }),
      );
      return;
    }

    if (parsed.data.behavior === "unavailable") {
      response.json(
        rpcError(envelope.data.id, -32001, "Dependency unavailable", {
          retryable: true,
        }),
      );
      return;
    }

    if (parsed.data.behavior === "malformed") {
      response.json({
        jsonrpc: "2.0",
        id: envelope.data.id,
        result: "upstream said maybe",
      });
      return;
    }

    if (parsed.data.behavior === "slow") {
      await new Promise((resolve) => setTimeout(resolve, slowDelayMs));
    }

    response.json({
      jsonrpc: "2.0",
      id: envelope.data.id,
      result: {
        accepted: true,
        experimentId: parsed.data.experimentId,
        echo: parsed.data.payload,
        processedAt: new Date().toISOString(),
      },
    });
  });

  return app;
}
