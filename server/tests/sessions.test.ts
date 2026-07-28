import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication, type AimLedgerApplication } from "../src/app.js";

describe("practice sessions", () => {
  let application: AimLedgerApplication | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    application?.close();
    application = undefined;

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("records a practice session and retrieves it later", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "aimledger.sqlite"),
    });

    const created = await request(application.app)
      .post("/api/sessions")
      .send({
        playedAt: "2026-07-28",
        map: "Dust II",
        goal: "Practise counter-strafing before queueing",
        durationMinutes: 30,
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.any(Number),
      playedAt: "2026-07-28",
      map: "Dust II",
      goal: "Practise counter-strafing before queueing",
      durationMinutes: 30,
    });

    const listed = await request(application.app).get("/api/sessions");

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([created.body]);
  });

  it("rejects a session with a non-positive duration", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "aimledger.sqlite"),
    });

    const response = await request(application.app)
      .post("/api/sessions")
      .send({
        playedAt: "2026-07-28",
        map: "Dust II",
        goal: "Practise counter-strafing",
        durationMinutes: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "Invalid practice session",
      details: {
        durationMinutes: expect.any(Array),
      },
    });
  });

  it("adds a drill result to a session and returns it with session details", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "aimledger.sqlite"),
    });

    const session = await request(application.app)
      .post("/api/sessions")
      .send({
        playedAt: "2026-07-28",
        map: "Dust II",
        goal: "Build a repeatable warm-up",
        durationMinutes: 25,
      });

    const result = await request(application.app)
      .post(`/api/sessions/${session.body.id}/results`)
      .send({
        drillName: "Counter-strafe wall targets",
        attempts: 40,
        successes: 31,
        notes: "Misses increased when changing direction to the left.",
      });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      id: expect.any(Number),
      sessionId: session.body.id,
      drillName: "Counter-strafe wall targets",
      attempts: 40,
      successes: 31,
      notes: "Misses increased when changing direction to the left.",
    });

    const details = await request(application.app).get(
      `/api/sessions/${session.body.id}`,
    );

    expect(details.status).toBe(200);
    expect(details.body).toMatchObject({
      ...session.body,
      results: [result.body],
    });
  });

  it("rejects a drill result whose successes exceed its attempts", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "aimledger.sqlite"),
    });

    const session = await request(application.app)
      .post("/api/sessions")
      .send({
        playedAt: "2026-07-28",
        map: "Mirage",
        goal: "Measure first-bullet accuracy",
        durationMinutes: 20,
      });

    const response = await request(application.app)
      .post(`/api/sessions/${session.body.id}/results`)
      .send({
        drillName: "Static target taps",
        attempts: 10,
        successes: 11,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "Invalid drill result",
      details: {
        successes: expect.any(Array),
      },
    });
  });

  it("returns a controlled error for a result linked to a missing session", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    application = buildApplication({
      databasePath: path.join(temporaryDirectory, "aimledger.sqlite"),
    });

    const response = await request(application.app)
      .post("/api/sessions/999/results")
      .send({
        drillName: "Counter-strafe wall targets",
        attempts: 20,
        successes: 14,
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Practice session not found",
    });
  });

  it("retains practice sessions when the application restarts", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "aimledger-test-"));
    const databasePath = path.join(
      temporaryDirectory,
      "aimledger.sqlite",
    );
    application = buildApplication({ databasePath });

    const created = await request(application.app)
      .post("/api/sessions")
      .send({
        playedAt: "2026-07-28",
        map: "Ancient",
        goal: "Repeat utility line-ups",
        durationMinutes: 15,
      });

    application.close();
    application = buildApplication({ databasePath });

    const listed = await request(application.app).get("/api/sessions");

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([created.body]);
  });
});
