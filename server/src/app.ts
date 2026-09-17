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

export type RelayLabApplication = {
  app: express.Express;
  close: () => Promise<void>;
};

export function buildApplication({
  databasePath,
  database: suppliedDatabase,
  downstreamUrl = "http://127.0.0.1:3001",
  timeoutMs = 400,
  clientDirectory,
  log = () => {},
}: {
  databasePath: string;
  database?: RelayLabDatabase;
  downstreamUrl?: string;
  timeoutMs?: number;
  clientDirectory?: string;
  log?: (line: string) => void;
}): RelayLabApplication {
  const database = suppliedDatabase ?? openDatabase(databasePath);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "relaylab-coordinator" });
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
    const experiment = await database.getExperiment(
      Number(request.params.experimentId),
    );
    if (!experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }
    response.json(experiment);
  });

  app.post("/api/experiments/:experimentId/runs", async (request, response) => {
    const experimentId = Number(request.params.experimentId);
    const experiment = await database.getExperiment(experimentId);
    if (!experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }

    const rpcRequest = buildDownstreamRpcRequest(experiment);
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
      let body: Record<string, unknown> | string;
      try {
        body = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        body = responseText;
      }

      const rpcOutcome = classifyDownstreamRpcResponse(body, rpcRequest.id);
      runInput = {
        experimentId,
        outcome:
          downstream.ok ? rpcOutcome : "downstream_error",
        httpStatus: downstream.status,
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
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: null,
      };
    }
    log(`reply rpc=${rpc} outcome=${runInput.outcome} http=${runInput.httpStatus ?? "-"} ${runInput.durationMs}ms`);
    // Storage failures must not be reclassified as downstream network failures.
    const run = await database.createRun(runInput);
    log(`saved run=${run.id} experiment=${experimentId} outcome=${run.outcome}`);
    response.status(201).json(run);
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
