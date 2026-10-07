import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApplication } from "../src/app.js";

describe("researcher/reviewer handoff", () => {
  let application: ReturnType<typeof buildApplication>;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "relaylab-reviews-"));
    application = buildApplication({ databasePath: path.join(directory, "lab.sqlite"), downstreamUrl: "http://127.0.0.1:1", reviewDemoEnabled: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function session(actorId: string) {
    const response = await request(application.app).post("/api/demo-sessions").send({ actorId }).expect(201);
    return `Bearer ${response.body.token}`;
  }

  async function recordedRun() {
    const experiment = await request(application.app).post("/api/experiments").send({ name: "Reviewable failure", behavior: "healthy", payload: {} }).expect(201);
    const run = await request(application.app).post(`/api/experiments/${experiment.body.id}/runs`).expect(201);
    return run.body;
  }

  it("hands a failed run to the reviewer and returns approval/feedback to its researcher", async () => {
    const researcher = await session("researcher-a");
    const reviewer = await session("reviewer");
    const run = await recordedRun();
    const submitted = await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", researcher).expect(201);
    expect(submitted.body).toMatchObject({ runId: run.id, researcherId: "researcher-a", status: "pending", feedback: null });
    const queue = await request(application.app).get("/api/reviews").set("Authorization", reviewer).expect(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].run.outcome).toBe("unreachable");
    await request(application.app).patch(`/api/reviews/${submitted.body.id}`).set("Authorization", reviewer).send({ status: "approved", feedback: "Useful evidence of an unavailable dependency." }).expect(200);
    const own = await request(application.app).get("/api/reviews").set("Authorization", researcher).expect(200);
    expect(own.body[0]).toMatchObject({ status: "approved", reviewerId: "reviewer", feedback: "Useful evidence of an unavailable dependency.", run: { outcome: "unreachable" } });
  });

  it("requires a session and rejects actions belonging to the other role", async () => {
    await request(application.app).get("/api/reviews").expect(401);
    await request(application.app).get("/api/reviews").set("Authorization", "Bearer made-up").expect(401);
    const researcher = await session("researcher-a");
    const reviewer = await session("reviewer");
    const run = await recordedRun();
    await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", reviewer).expect(403);
    const submitted = await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", researcher).expect(201);
    await request(application.app).patch(`/api/reviews/${submitted.body.id}`).set("Authorization", researcher).send({ status: "approved", feedback: "Self approval" }).expect(403);
  });

  it("isolates researchers and refuses a duplicate submission even from another researcher", async () => {
    const first = await session("researcher-a");
    const second = await session("researcher-b");
    const run = await recordedRun();
    const submitted = await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", first).expect(201);
    await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", second).expect(409);
    const otherList = await request(application.app).get("/api/reviews").set("Authorization", second).expect(200);
    expect(otherList.body).toEqual([]);
    await request(application.app).get(`/api/reviews/${submitted.body.id}`).set("Authorization", second).expect(404);
  });

  it("requires valid feedback and allows only one concurrent decision to win", async () => {
    const researcher = await session("researcher-a");
    const reviewer = await session("reviewer");
    const run = await recordedRun();
    const submitted = await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", researcher).expect(201);
    const endpoint = `/api/reviews/${submitted.body.id}`;
    for (const body of [{ status: "pending", feedback: "No" }, { status: "approved", feedback: "  " }, { status: "rejected", feedback: "x".repeat(2001) }, { status: "approved", feedback: "Okay", reviewerId: "spoof" }]) {
      await request(application.app).patch(endpoint).set("Authorization", reviewer).send(body).expect(400);
    }
    const outcomes = await Promise.all([
      request(application.app).patch(endpoint).set("Authorization", reviewer).send({ status: "approved", feedback: "Accept failure evidence" }),
      request(application.app).patch(endpoint).set("Authorization", reviewer).send({ status: "rejected", feedback: "Need a new run" }),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual([200, 409]);
    const saved = await request(application.app).get(endpoint).set("Authorization", researcher).expect(200);
    expect(saved.body.status).toBe(outcomes.find((result) => result.status === 200)!.body.status);
  });

  it("preserves reviewed evidence and survives a coordinator restart", async () => {
    const researcher = await session("researcher-a");
    const reviewer = await session("reviewer");
    const run = await recordedRun();
    const submitted = await request(application.app).post(`/api/runs/${run.id}/reviews`).set("Authorization", researcher).expect(201);
    await request(application.app).patch(`/api/reviews/${submitted.body.id}`).set("Authorization", reviewer).send({ status: "rejected", feedback: "Please rerun with the dependency started." }).expect(200);
    await request(application.app).delete(`/api/experiments/${run.experimentId}`).expect(409);
    await application.close();
    application = buildApplication({ databasePath: path.join(directory, "lab.sqlite"), reviewDemoEnabled: true });
    await request(application.app).get("/api/reviews").set("Authorization", researcher).expect(401);
    const resumed = await session("researcher-a");
    const result = await request(application.app).get("/api/reviews").set("Authorization", resumed).expect(200);
    expect(result.body[0]).toMatchObject({ status: "rejected", feedback: "Please rerun with the dependency started.", run: { id: run.id, outcome: "unreachable" } });
  });

  it("expires and revokes demo sessions, and disables account selection unless explicitly enabled", async () => {
    const researcher = await session("researcher-a");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 60 * 60 * 1000 + 1);
    await request(application.app).get("/api/reviews").set("Authorization", researcher).expect(401);
    vi.restoreAllMocks();
    const fresh = await session("researcher-a");
    await request(application.app).delete("/api/demo-sessions/current").set("Authorization", fresh).expect(204);
    await request(application.app).get("/api/reviews").set("Authorization", fresh).expect(401);
    await application.close();
    application = buildApplication({ databasePath: path.join(directory, "lab.sqlite") });
    await request(application.app).post("/api/demo-sessions").send({ actorId: "reviewer" }).expect(403);
  });

  it("returns missing-resource errors for invalid IDs without creating submissions", async () => {
    const researcher = await session("researcher-a");
    const reviewer = await session("reviewer");
    await request(application.app).post("/api/demo-sessions").send({ actorId: "admin" }).expect(400);
    for (const value of ["0", "-1", "99999", "1.2", "not-a-number"]) {
      await request(application.app).post(`/api/runs/${value}/reviews`).set("Authorization", researcher).expect(404);
      await request(application.app).patch(`/api/reviews/${value}`).set("Authorization", reviewer).send({ status: "rejected", feedback: "Missing" }).expect(404);
    }
    expect((await request(application.app).get("/api/reviews").set("Authorization", reviewer)).body).toEqual([]);
  });
});
