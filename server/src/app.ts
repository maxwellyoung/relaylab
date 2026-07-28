import cors from "cors";
import express from "express";
import { z } from "zod";
import { openDatabase } from "./database.js";

const sessionInput = z.object({
  playedAt: z.string(),
  map: z.string(),
  goal: z.string(),
  durationMinutes: z.number().int().positive().max(480),
});

const drillResultInput = z
  .object({
    drillName: z.string().min(1).max(100),
    attempts: z.number().int().positive(),
    successes: z.number().int().nonnegative(),
    notes: z.string().max(500).optional().default(""),
  })
  .refine((result) => result.successes <= result.attempts, {
    message: "Successes cannot exceed attempts",
    path: ["successes"],
  });

export type AimLedgerApplication = {
  app: express.Express;
  close: () => void;
};

export function buildApplication({
  databasePath,
}: {
  databasePath: string;
}): AimLedgerApplication {
  const database = openDatabase(databasePath);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.post("/api/sessions", (request, response) => {
    const parsed = sessionInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid practice session",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    response.status(201).json(database.createSession(parsed.data));
  });

  app.get("/api/sessions", (_request, response) => {
    response.json(database.listSessions());
  });

  app.get("/api/sessions/:sessionId", (request, response) => {
    const sessionId = Number(request.params.sessionId);
    const session = database.getSession(sessionId);
    if (!session) {
      response.status(404).json({ error: "Practice session not found" });
      return;
    }

    response.json(session);
  });

  app.post("/api/sessions/:sessionId/results", (request, response) => {
    const sessionId = Number(request.params.sessionId);
    if (!database.getSession(sessionId)) {
      response.status(404).json({ error: "Practice session not found" });
      return;
    }

    const parsed = drillResultInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid drill result",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    response.status(201).json(
      database.createResult({
        sessionId,
        ...parsed.data,
      }),
    );
  });

  return {
    app,
    close: database.close,
  };
}
