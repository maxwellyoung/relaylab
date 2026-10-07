import { randomUUID } from "node:crypto";
import type express from "express";
import { z } from "zod";
import type { RelayLabDatabase } from "./database.js";

const actors = {
  "researcher-a": { id: "researcher-a", name: "Researcher A", role: "researcher" },
  "researcher-b": { id: "researcher-b", name: "Researcher B", role: "researcher" },
  reviewer: { id: "reviewer", name: "Reviewer", role: "reviewer" },
} as const;
const sessionInput = z.object({ actorId: z.enum(["researcher-a", "researcher-b", "reviewer"]) }).strict();
export const reviewDecisionInput = z.object({
  status: z.enum(["approved", "rejected"]),
  feedback: z.string().trim().min(1).max(2000),
}).strict();
type Actor = (typeof actors)[keyof typeof actors];

function id(value: string): number | undefined {
  return /^[1-9][0-9]{0,14}$/.test(value) ? Number(value) : undefined;
}

export function installReviewRoutes(app: express.Express, database: RelayLabDatabase, enabled: boolean) {
  // Explicitly opt-in demo accounts. These model distinct clients, but anyone
  // can select an account; this is not password authentication or production security.
  const sessions = new Map<string, { actor: Actor; expiresAt: number }>();
  app.post("/api/demo-sessions", (request, response) => {
    if (!enabled) {
      response.status(403).json({ error: "Review demo is disabled. Start the coordinator with RELAYLAB_REVIEW_DEMO=true." });
      return;
    }
    const parsed = sessionInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Choose a known demo account" });
      return;
    }
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
    if (sessions.size >= 256) {
      response.status(429).json({ error: "Too many demo sessions; end an existing session first" });
      return;
    }
    const token = randomUUID();
    const actor = actors[parsed.data.actorId];
    sessions.set(token, { actor, expiresAt: now + 60 * 60 * 1000 });
    response.set("Cache-Control", "no-store").status(201).json({ token, actor });
  });

  function actorFor(request: express.Request, response: express.Response): Actor | undefined {
    response.set("Cache-Control", "no-store");
    const token = request.get("Authorization")?.match(/^Bearer ([0-9a-f-]{36})$/)?.[1];
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      response.status(401).json({ error: "Choose a demo account again; the session is missing or expired" });
      return undefined;
    }
    return session.actor;
  }

  app.delete("/api/demo-sessions/current", (request, response) => {
    if (!actorFor(request, response)) return;
    sessions.delete(request.get("Authorization")!.slice("Bearer ".length));
    response.status(204).end();
  });

  app.get("/api/reviews", async (request, response) => {
    const actor = actorFor(request, response);
    if (!actor) return;
    response.json(await database.listReviews(actor.role === "researcher" ? actor.id : undefined));
  });

  app.post("/api/runs/:runId/reviews", async (request, response) => {
    const actor = actorFor(request, response);
    if (!actor) return;
    if (actor.role !== "researcher") {
      response.status(403).json({ error: "Only a researcher can submit a run" });
      return;
    }
    const runId = id(request.params.runId);
    if (!runId || !await database.getRun(runId)) {
      response.status(404).json({ error: "Run not found" });
      return;
    }
    const review = await database.createReview(runId, actor.id);
    response.location(`/api/reviews/${review.id}`).status(201).json(review);
  });

  app.get("/api/reviews/:reviewId", async (request, response) => {
    const actor = actorFor(request, response);
    if (!actor) return;
    const reviewId = id(request.params.reviewId);
    const review = reviewId ? await database.getReview(reviewId) : undefined;
    if (!review || (actor.role === "researcher" && review.researcherId !== actor.id)) {
      response.status(404).json({ error: "Review not found" });
      return;
    }
    response.json(review);
  });

  app.patch("/api/reviews/:reviewId", async (request, response) => {
    const actor = actorFor(request, response);
    if (!actor) return;
    if (actor.role !== "reviewer") {
      response.status(403).json({ error: "Only a reviewer can decide a review" });
      return;
    }
    const parsed = reviewDecisionInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Choose approved or rejected and provide feedback (1–2000 characters)" });
      return;
    }
    const reviewId = id(request.params.reviewId);
    if (!reviewId || !await database.getReview(reviewId)) {
      response.status(404).json({ error: "Review not found" });
      return;
    }
    const review = await database.decideReview(reviewId, parsed.data.status, parsed.data.feedback, actor.id);
    if (!review) {
      response.status(409).json({ error: "This run has already been reviewed. Refresh to see the decision." });
      return;
    }
    response.json(review);
  });
}
