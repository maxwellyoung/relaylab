import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Experiment } from "./database.js";

export const DOWNSTREAM_RPC_METHOD = "relaylab.process.v1";

const rpcId = z.union([z.string(), z.number()]);

const downstreamResult = z.object({
  accepted: z.literal(true),
  experimentId: z.number().int().positive(),
  echo: z.record(z.string(), z.unknown()),
  processedAt: z.string(),
});

const rpcSuccess = z.object({
  jsonrpc: z.literal("2.0"),
  id: rpcId,
  result: downstreamResult,
});

const rpcError = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([rpcId, z.null()]),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type DownstreamRpcRequest = ReturnType<typeof buildDownstreamRpcRequest>;

export function buildDownstreamRpcRequest(experiment: Experiment) {
  return {
    jsonrpc: "2.0" as const,
    id: randomUUID(),
    method: DOWNSTREAM_RPC_METHOD,
    params: {
      experimentId: experiment.id,
      behavior: experiment.behavior,
      payload: experiment.payload,
    },
  };
}

export function classifyDownstreamRpcResponse(
  body: unknown,
  expectedId: string | number,
): "success" | "downstream_error" | "invalid_response" {
  const success = rpcSuccess.safeParse(body);
  if (success.success && success.data.id === expectedId) {
    return "success";
  }

  const error = rpcError.safeParse(body);
  if (error.success && error.data.id === expectedId) {
    return "downstream_error";
  }

  return "invalid_response";
}
