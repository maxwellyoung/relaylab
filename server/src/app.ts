import cors from "cors";
import express from "express";
import path from "node:path";
import {
  openDatabase,
  type RelayLabDatabase,
} from "./database.js";
import { experimentInputSchema } from "./public-contract.js";
import {
  buildDownstreamRpcRequest,
  classifyDownstreamRpcResponse,
} from "./downstream-rpc.js";

function readHeader(request: express.Request, name: string, maxLength: number): string | null {
  const value = request.get(name)?.trim();
  return value && value.length <= maxLength && /^[\w.:-]+$/.test(value) ? value : null;
}

function parseExperimentId(value: string): number | undefined {
  return /^[1-9][0-9]{0,14}$/.test(value) ? Number(value) : undefined;
}

export type RelayLabApplication = {
  app: express.Express;
  close: () => Promise<void>;
};

export function buildApplication({
  databasePath,
  database: suppliedDatabase,
  downstreamUrl = "http://127.0.0.1:3001",
  timeoutMs = 400,
  databaseDriver = "sqlite",
  clientDirectory,
  log = () => {},
}: {
  databasePath: string;
  database?: RelayLabDatabase;
  downstreamUrl?: string;
  timeoutMs?: number;
  databaseDriver?: string;
  clientDirectory?: string;
  log?: (line: string) => void;
}): RelayLabApplication {
  const database = suppliedDatabase ?? openDatabase(databasePath);
  const app = express();

  app.use(cors({ exposedHeaders: ["X-Correlation-Id"] }));
  app.use(express.json());

  app.get("/health", (_request, response) => {
    // Report the live configuration so a reader never has to trust a hardcoded
    // number. Nothing here identifies the database or its credentials.
    response.json({
      status: "ok",
      service: "relaylab-coordinator",
      database: databaseDriver,
      downstreamTimeoutMs: timeoutMs,
    });
  });

  app.post("/api/experiments", async (request, response) => {
    const parsed = experimentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      log("rejected experiment: invalid input (400)");
      response.status(400).json({
        error: "Invalid experiment",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const experiment = await database.createExperiment(parsed.data);
    log(`created experiment=${experiment.id} behavior=${experiment.behavior}`);
    response.status(201).json(experiment);
  });

  app.get("/api/experiments", async (_request, response) => {
    response.json(await database.listExperiments());
  });

  app.get("/api/experiments/:experimentId", async (request, response) => {
    const experimentId = parseExperimentId(request.params.experimentId);
    const experiment = experimentId === undefined
      ? undefined
      : await database.getExperiment(experimentId);
    if (!experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }
    response.json(experiment);
  });

  app.post("/api/experiments/:experimentId/runs", async (request, response) => {
    const experimentId = parseExperimentId(request.params.experimentId);
    const experiment = experimentId === undefined
      ? undefined
      : await database.getExperiment(experimentId);
    if (experimentId === undefined || !experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }

    // A caller may mint the exchange id and mark the request as a retry of an
    // earlier one. A settled result for the same key is replayed without
    // calling the dependency; an unsettled attempt (timeout, unreachable) is
    // sent again, and the dependency dedupes so the work still runs once.
    const idempotencyKey = readHeader(request, "idempotency-key", 80);
    if (idempotencyKey) {
      const earlier = await database.findRunByKey(experimentId, idempotencyKey);
      if (earlier && earlier.outcome !== "timeout" && earlier.outcome !== "unreachable") {
        log(`replayed run=${earlier.id} experiment=${experimentId} key=${idempotencyKey.slice(0, 8)}`);
        response.setHeader("X-Idempotent-Replay", "true");
        if (typeof earlier.response === "object" && earlier.response && typeof earlier.response.id === "string") {
          response.setHeader("X-Correlation-Id", earlier.response.id);
        }
        response.status(200).json(earlier);
        return;
      }
    }

    const rpcRequest = buildDownstreamRpcRequest(experiment, {
      correlationId: readHeader(request, "x-request-id", 36),
      idempotencyKey,
    });
    const rpc = rpcRequest.id.slice(0, 8);
    log(`run experiment=${experimentId} behavior=${experiment.behavior} -> ${rpcRequest.method} rpc=${rpc}`);
    const startedAt = performance.now();
    let runInput: Parameters<RelayLabDatabase["createRun"]>[0];
    try {
      const downstream = await fetch(`${downstreamUrl}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpcRequest),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await downstream.text();
      // Keep the parsed value only when it is a JSON object. A scalar or null
      // would otherwise be stored as evidence the public contract rejects.
      let body: Record<string, unknown> | string = responseText;
      try {
        const parsed = JSON.parse(responseText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = responseText;
      }

      const classification = classifyDownstreamRpcResponse(body, rpcRequest.id, experimentId);
      runInput = {
        experimentId,
        // A correlated RPC error is the dependency's own answer even if the
        // transport failed; only an uncorrelated failure is a transport fault.
        outcome: classification.outcome === "downstream_error" || downstream.ok
          ? classification.outcome
          : "downstream_error",
        httpStatus: downstream.status,
        rpcErrorCode: classification.errorCode,
        idempotencyKey,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: body,
      };
    } catch (reason) {
      runInput = {
        experimentId,
        outcome:
          reason instanceof Error && reason.name === "TimeoutError"
            ? "timeout"
            : "unreachable",
        httpStatus: null,
        rpcErrorCode: null,
        idempotencyKey,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: null,
      };
    }
    log(`reply rpc=${rpc} outcome=${runInput.outcome} http=${runInput.httpStatus ?? "-"} ${runInput.durationMs}ms`);
    // Hand the correlation ID back so a caller can match this run to both logs.
    response.setHeader("X-Correlation-Id", rpcRequest.id);
    // Storage failures must not be reclassified as downstream network failures.
    const run = await database.createRun(runInput);
    log(`saved run=${run.id} experiment=${experimentId} outcome=${run.outcome}`);
    response.status(201).json(run);
  });

  app.delete("/api/experiments/:experimentId", async (request, response) => {
    const experimentId = parseExperimentId(request.params.experimentId);
    const deleted = experimentId !== undefined
      && await database.deleteExperiment(experimentId);
    if (!deleted) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }
    log(`deleted experiment=${experimentId} with its runs`);
    response.status(204).end();
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  if (clientDirectory) {
    app.use(express.static(clientDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(clientDirectory, "index.html"));
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    // The JSON parser runs before our handlers; its failures are input errors.
    if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
      response.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    // A request-level error carries its own status: an oversized body is 413,
    // not a claim that the database is unavailable.
    const status = error instanceof Error && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      console.error("RelayLab rejected a request", { status });
      response.status(status).json({ error: "Request rejected" });
      return;
    }
    console.error("RelayLab request failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    response.status(503).json({ error: "Persistence temporarily unavailable" });
  });

  return {
    app,
    close: () => database.close(),
  };
}
