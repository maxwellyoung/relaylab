import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDownstreamService } from "../src/app.js";

describe("downstream processing service", () => {
  it("echoes a healthy request with processing evidence", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/api/process")
      .send({
        experimentId: 7,
        behavior: "healthy",
        payload: { orderId: "ORDER-42", quantity: 2 },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accepted: true,
      experimentId: 7,
      echo: { orderId: "ORDER-42", quantity: 2 },
      processedAt: expect.any(String),
    });
  });

  it("returns a controlled service error when unavailable", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/api/process")
      .send({
        experimentId: 8,
        behavior: "unavailable",
        payload: { orderId: "ORDER-43" },
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Simulated downstream outage",
      retryable: true,
    });
  });

  it("can delay a response to make timeout handling reproducible", async () => {
    const service = buildDownstreamService({ slowDelayMs: 25 });
    const startedAt = performance.now();

    const response = await request(service)
      .post("/api/process")
      .send({
        experimentId: 9,
        behavior: "slow",
        payload: { orderId: "ORDER-44" },
      });

    expect(response.status).toBe(200);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(response.body).toMatchObject({
      accepted: true,
      experimentId: 9,
      echo: { orderId: "ORDER-44" },
    });
  });

  it("can return a malformed body for response-validation checks", async () => {
    const service = buildDownstreamService();

    const response = await request(service)
      .post("/api/process")
      .send({
        experimentId: 10,
        behavior: "malformed",
        payload: { orderId: "ORDER-45" },
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toBe("upstream said maybe");
  });
});
