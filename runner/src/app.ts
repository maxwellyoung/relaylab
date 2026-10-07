import { Server, ServerCredentials, status, type sendUnaryData, type ServerUnaryCall } from "@grpc/grpc-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runnerDefinition, type ExecuteRunRequest, type Execution, type GetExecutionRequest } from "../../protocol/runner.mjs";
import { openExecutionStore } from "./store.js";

const requestSchema = z.object({
  operationId: z.string().min(1).max(200), correlationId: z.uuid(),
  experimentRef: z.string().min(1).max(80),
  behavior: z.enum(["healthy", "slow", "unavailable", "malformed"]),
  payloadJson: z.string().max(64000),
});
const payloadSchema = z.record(z.string(), z.unknown());
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function buildRunner({ databasePath, slowDelayMs = 800, log = () => {} }: {
  databasePath: string; slowDelayMs?: number; log?: (line: string) => void;
}) {
  const store = openExecutionStore(databasePath);
  const server = new Server({ "grpc.max_receive_message_length": 128 * 1024 });
  const pending = new Map<string, Promise<Execution>>();
  let closing = false;

  async function execute(request: ExecuteRunRequest): Promise<Execution> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) throw { code: status.INVALID_ARGUMENT, message: "Invalid execution request" };
    if (Buffer.byteLength(request.payloadJson, "utf8") > 64000) throw { code: status.INVALID_ARGUMENT, message: "Payload exceeds the 64 KB runner limit" };
    let payload: Record<string, unknown>;
    try { payload = payloadSchema.parse(JSON.parse(request.payloadJson)); }
    catch { throw { code: status.INVALID_ARGUMENT, message: "Payload must be a JSON object" }; }
    const fingerprint = createHash("sha256").update(canonical({ experimentRef: request.experimentRef, behavior: request.behavior, payload })).digest("hex");
    const existing = store.find(request.operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw { code: status.ALREADY_EXISTS, message: "Operation ID belongs to a different execution request" };
      if (existing.state === "INTERRUPTED") throw { code: status.ABORTED, message: "Prior execution was interrupted; inspect and use a new operation ID" };
      const work = pending.get(request.operationId);
      if (work) return work;
      if (existing.state === "COMPLETED") {
        log(`replayed execution=${existing.executionId.slice(0, 8)} correlation=${request.correlationId.slice(0, 8)}`);
        return existing;
      }
      throw { code: status.ABORTED, message: "Execution state requires inspection" };
    }
    const started = store.start(request, fingerprint);
    log(`started execution=${started.executionId.slice(0, 8)} correlation=${request.correlationId.slice(0, 8)}`);
    // A durable job is accepted before waiting. An RPC deadline abandons the
    // wait, not the execution; GetExecution/retry can recover its result.
    const work = (async () => {
      if (request.behavior === "slow") await new Promise((resolve) => setTimeout(resolve, slowDelayMs));
      const outcome = request.behavior === "unavailable" ? "downstream_error" : request.behavior === "malformed" ? "invalid_response" : "success";
      const result = request.behavior === "unavailable" ? { error: "Simulated execution dependency unavailable", retryable: true }
        : request.behavior === "malformed" ? "invalid experiment result"
        : { accepted: true, experimentRef: request.experimentRef, echo: payload, processedAt: new Date().toISOString() };
      const completed = store.complete(request.operationId, outcome, result);
      log(`completed execution=${completed.executionId.slice(0, 8)} outcome=${outcome}`);
      return completed;
    })();
    pending.set(request.operationId, work);
    try { return await work; } finally { pending.delete(request.operationId); }
  }

  function fail(error: unknown, callback: sendUnaryData<Execution>) {
    if (error && typeof error === "object" && "code" in error && "message" in error && typeof error.code === "number" && typeof error.message === "string") {
      callback({ code: error.code, message: error.message });
      return;
    }
    callback({ code: status.INTERNAL, message: "Execution persistence unavailable" });
  }

  server.addService(runnerDefinition, {
    executeRun(call: ServerUnaryCall<ExecuteRunRequest, Execution>, callback: sendUnaryData<Execution>) {
      if (closing) { callback({ code: status.UNAVAILABLE, message: "Runner is shutting down" }); return; }
      void execute(call.request).then((result) => callback(null, result), (error) => fail(error, callback));
    },
    getExecution(call: ServerUnaryCall<GetExecutionRequest, Execution>, callback: sendUnaryData<Execution>) {
      if (closing) { callback({ code: status.UNAVAILABLE, message: "Runner is shutting down" }); return; }
      if (!call.request.operationId || call.request.operationId.length > 200) { callback({ code: status.INVALID_ARGUMENT, message: "Invalid operation ID" }); return; }
      try {
        const result = store.find(call.request.operationId);
        if (!result) { callback({ code: status.NOT_FOUND, message: "Execution not found" }); return; }
        callback(null, result);
      } catch (error) { fail(error, callback); }
    },
  });
  return {
    server,
    bind(target: string): Promise<number> {
      // The current local integration uses loopback without TLS. A deployment
      // must explicitly provide transport credentials and a protected network.
      return new Promise((resolve, reject) => server.bindAsync(target, ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
    },
    async close() {
      if (closing) return;
      closing = true;
      await Promise.allSettled(pending.values());
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
      store.close();
    },
  };
}
