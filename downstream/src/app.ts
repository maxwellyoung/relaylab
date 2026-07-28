import express from "express";
import { z } from "zod";

const processRequest = z.object({
  experimentId: z.number().int().positive(),
  behavior: z.enum(["healthy", "slow", "unavailable", "malformed"]),
  payload: z.record(z.string(), z.unknown()),
});

export function buildDownstreamService({
  slowDelayMs = 800,
}: {
  slowDelayMs?: number;
} = {}) {
  const app = express();

  app.use(express.json());

  app.post("/api/process", async (request, response) => {
    const parsed = processRequest.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid downstream request" });
      return;
    }

    if (parsed.data.behavior === "unavailable") {
      response.status(503).json({
        error: "Simulated downstream outage",
        retryable: true,
      });
      return;
    }

    if (parsed.data.behavior === "malformed") {
      response.type("text/plain").send("upstream said maybe");
      return;
    }

    if (parsed.data.behavior === "slow") {
      await new Promise((resolve) => setTimeout(resolve, slowDelayMs));
    } else if (parsed.data.behavior !== "healthy") {
      response.status(501).json({ error: "Behavior not implemented" });
      return;
    }

    response.json({
      accepted: true,
      experimentId: parsed.data.experimentId,
      echo: parsed.data.payload,
      processedAt: new Date().toISOString(),
    });
  });

  return app;
}
