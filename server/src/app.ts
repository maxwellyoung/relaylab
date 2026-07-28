import cors from "cors";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { experimentBehaviors, openDatabase } from "./database.js";

const experimentInput = z.object({
  name: z.string().trim().min(1).max(80),
  behavior: z.enum(experimentBehaviors),
  payload: z.record(z.string(), z.unknown()),
});

const downstreamResponse = z.object({
  accepted: z.literal(true),
  experimentId: z.number().int().positive(),
  echo: z.record(z.string(), z.unknown()),
  processedAt: z.string(),
});

export type RelayLabApplication = {
  app: express.Express;
  close: () => void;
};

export function buildApplication({
  databasePath,
  downstreamUrl = "http://127.0.0.1:3001",
  timeoutMs = 400,
  clientDirectory,
}: {
  databasePath: string;
  downstreamUrl?: string;
  timeoutMs?: number;
  clientDirectory?: string;
}): RelayLabApplication {
  const database = openDatabase(databasePath);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "relaylab-coordinator" });
  });

  app.post("/api/experiments", (request, response) => {
    const parsed = experimentInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid experiment",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    response.status(201).json(database.createExperiment(parsed.data));
  });

  app.get("/api/experiments", (_request, response) => {
    response.json(database.listExperiments());
  });

  app.get("/api/experiments/:experimentId", (request, response) => {
    const experiment = database.getExperiment(Number(request.params.experimentId));
    if (!experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }
    response.json(experiment);
  });

  app.post("/api/experiments/:experimentId/runs", async (request, response) => {
    const experimentId = Number(request.params.experimentId);
    const experiment = database.getExperiment(experimentId);
    if (!experiment) {
      response.status(404).json({ error: "Experiment not found" });
      return;
    }

    const startedAt = performance.now();
    try {
      const downstream = await fetch(`${downstreamUrl}/api/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experimentId,
          behavior: experiment.behavior,
          payload: experiment.payload,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await downstream.text();
      let body: Record<string, unknown> | string;
      try {
        body = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        body = responseText;
      }

      const validSuccess = downstreamResponse.safeParse(body);
      const run = database.createRun({
        experimentId,
        outcome:
          downstream.ok && validSuccess.success
            ? "success"
            : downstream.ok
              ? "invalid_response"
              : "downstream_error",
        httpStatus: downstream.status,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        response: body,
      });

      response.status(201).json(run);
    } catch (reason) {
      const run = database.createRun({
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

  return {
    app,
    close: database.close,
  };
}
