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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildDownstreamRpcRequest(
  experiment: Experiment,
  options: { correlationId?: string | null; idempotencyKey?: string | null } = {},
) {
  // A caller may mint the exchange id, so one value can be followed from the
  // browser through the coordinator to the dependency's log.
  const id = options.correlationId && UUID.test(options.correlationId)
    ? options.correlationId.toLowerCase()
    : randomUUID();
  return {
    jsonrpc: "2.0" as const,
    id,
    method: DOWNSTREAM_RPC_METHOD,
    params: {
      experimentId: experiment.id,
      behavior: experiment.behavior,
      payload: experiment.payload,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    },
  };
}

export type DownstreamRpcOutcome = {
  outcome: "success" | "downstream_error" | "invalid_response";
  errorCode: number | null;
};

export function classifyDownstreamRpcResponse(
  body: unknown,
  expectedId: string | number,
  expectedExperimentId?: number,
): DownstreamRpcOutcome {
  // JSON-RPC permits a result or an error, never both, even if each object
  // separately matches a schema. Keep contradictory evidence out of success.
  if (body && typeof body === "object" && "result" in body && "error" in body) {
    return { outcome: "invalid_response", errorCode: null };
  }
  const success = rpcSuccess.safeParse(body);
  if (success.success && success.data.id === expectedId
      && (expectedExperimentId === undefined || success.data.result.experimentId === expectedExperimentId)) {
    return { outcome: "success", errorCode: null };
  }

  const error = rpcError.safeParse(body);
  if (error.success && error.data.id === expectedId) {
    // The method failed. Keep its code queryable rather than only inside the envelope.
    return { outcome: "downstream_error", errorCode: error.data.error.code };
  }

  return { outcome: "invalid_response", errorCode: null };
}
