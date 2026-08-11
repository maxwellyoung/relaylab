import cors from "cors";
import express from "express";
import path from "node:path";
import { z } from "zod";
import {
  experimentBehaviors,
  openDatabase,
  type RelayLabDatabase,
} from "./database.js";
import {
  buildDownstreamRpcRequest,
  classifyDownstreamRpcResponse,
} from "./downstream-rpc.js";

const experimentInput = z.object({
  name: z.string().trim().min(1).max(80),
  behavior: z.enum(experimentBehaviors),
  payload: z.record(z.string(), z.unknown()),
});

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
}: {
  databasePath: string;
  database?: RelayLabDatabase;
  downstreamUrl?: string;
  timeoutMs?: number;
  clientDirectory?: string;
}): RelayLabApplication {
  const database = suppliedDatabase ?? openDatabase(databasePath);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "relaylab-coordinator" });
  });

  app.post("/api/experiments", async (request, response) => {
    const parsed = experimentInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid experiment",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    response.status(201).json(await database.createExperiment(parsed.data));
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

    const startedAt = performance.now();
    try {
      const rpcRequest = buildDownstreamRpcRequest(experiment);
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
      const run = await database.createRun({
        experimentId,
        outcome:
          downstream.ok ? rpcOutcome : "downstream_error",
        httpStatus: downstream.status,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: body,
      });

      response.status(201).json(run);
    } catch (reason) {
      const run = await database.createRun({
        experimentId,
        outcome:
          reason instanceof Error && reason.name === "TimeoutError"
            ? "timeout"
            : "unreachable",
        httpStatus: null,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: null,
      });
      response.status(201).json(run);
    }
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
