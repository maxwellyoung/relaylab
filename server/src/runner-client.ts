import { credentials, status, type ServiceError } from "@grpc/grpc-js";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { RunnerClient, type Execution } from "../../protocol/runner.mjs";
import type { Experiment, ExperimentRun } from "./database.js";

const executionSchema = z.object({
  executionId: z.uuid(), operationId: z.string(), experimentRef: z.string(),
  state: z.enum(["RUNNING", "COMPLETED", "INTERRUPTED"]),
  outcome: z.string(), resultJson: z.string(), startedAt: z.iso.datetime(), completedAt: z.string(),
});
const resultSchema = z.object({
  accepted: z.literal(true), experimentRef: z.string(),
  echo: z.record(z.string(), z.unknown()), processedAt: z.iso.datetime(),
});

export function createRunnerConnection(target: string, timeoutMs: number, namespace = "relaylab") {
  if (!/^(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(target)) throw new Error("The local gRPC runner must use a loopback target");
  if (!/^[\w-]{1,32}$/.test(namespace)) throw new Error("Invalid runner namespace");
  const connect = () => new RunnerClient(target, credentials.createInsecure(), { "grpc.use_local_subchannel_pool": 1 });
  let client = connect();
  let activeCalls = 0;
  let reconnectWhenIdle = false;
  let closed = false;
  function call(invoke: (connection: RunnerClient, callback: (error: ServiceError | null, response?: Execution) => void) => void): Promise<Execution> {
    return new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Runner connection is closed")); return; }
      activeCalls++;
      invoke(client, (error, response) => {
        if (error?.code === status.UNAVAILABLE) reconnectWhenIdle = true;
        activeCalls--;
        // Do not leave the next manual retry stuck in the failed channel's
        // reconnect backoff, and do not cancel another in-flight execution.
        if (!activeCalls && reconnectWhenIdle && !closed) {
          client.close(); client = connect(); reconnectWhenIdle = false;
        }
        if (error) reject(error); else resolve(response!);
      });
    });
  }
  function getExecution(operationId: string): Promise<Execution> {
    return call((connection, callback) => { connection.getExecution({ operationId }, { deadline: Date.now() + timeoutMs }, callback); }).then((response) => {
      const parsed = executionSchema.safeParse(response);
      if (!parsed.success || parsed.data.operationId !== operationId) throw new Error("Runner returned an invalid execution");
      return parsed.data;
    });
  }
  return {
    getExecution,
    close() { closed = true; client.close(); },
    async execute(experiment: Experiment, correlationId: string, idempotencyKey: string | null): Promise<Pick<ExperimentRun, "outcome" | "httpStatus" | "rpcErrorCode" | "response">> {
      const operationId = `${namespace}:${experiment.id}:${idempotencyKey ?? correlationId}`;
      const experimentRef = `${namespace}:experiment:${experiment.id}`;
      let execution: Execution;
      try {
        execution = await call((connection, callback) => { connection.executeRun({ operationId, correlationId, experimentRef, behavior: experiment.behavior, payloadJson: JSON.stringify(experiment.payload) },
          { deadline: Date.now() + timeoutMs }, callback); });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? Number(error.code) : status.UNKNOWN;
        return {
          outcome: code === status.DEADLINE_EXCEEDED ? "timeout" : code === status.UNAVAILABLE ? "unreachable" : "downstream_error",
          httpStatus: null, rpcErrorCode: code,
          response: { transport: "grpc", id: correlationId, operationId, grpcStatus: code,
            message: code === status.DEADLINE_EXCEEDED ? "Runner deadline exceeded; an accepted execution may still complete. Check execution status or retry with the same key."
              : code === status.UNAVAILABLE ? "Runner unavailable. Restore the runner, then retry or check execution status."
              : "Runner refused or could not persist the execution; inspect its status before starting new work." },
        };
      }
      const parsed = executionSchema.safeParse(execution);
      let result: unknown;
      try { result = JSON.parse(execution.resultJson); } catch { result = execution.resultJson; }
      const success = resultSchema.safeParse(result);
      const validIdentity = parsed.success && execution.operationId === operationId && execution.experimentRef === experimentRef && execution.state === "COMPLETED";
      const validSuccess = success.success && success.data.experimentRef === experimentRef && isDeepStrictEqual(success.data.echo, experiment.payload);
      const validFailure = result && typeof result === "object" && "error" in result && typeof result.error === "string";
      const outcome = !validIdentity ? "invalid_response" : execution.outcome === "success" && validSuccess ? "success"
        : execution.outcome === "downstream_error" && validFailure ? "downstream_error" : "invalid_response";
      return { outcome, httpStatus: null, rpcErrorCode: null,
        response: { transport: "grpc", id: correlationId, operationId, grpcStatus: 0, execution: { ...execution }, result: result as Record<string, unknown> | string | null } };
    },
  };
}

export function runnerErrorStatus(error: unknown): number {
  const code = (error as Partial<ServiceError> | undefined)?.code;
  return code === status.NOT_FOUND ? 404 : 503;
}
