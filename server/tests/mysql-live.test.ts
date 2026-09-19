import { describe, expect, it } from "vitest";
import { openDatabaseFromEnvironment } from "../src/database.js";

// Runs only when lecturer MySQL settings are present in the environment, so the
// ordinary suite stays credential-free while the same assertions can be proved
// against the real server: node --env-file=.env node_modules/.bin/vitest run mysql-live
const configured = process.env.RELAYLAB_DATABASE_DRIVER === "mysql"
  && Boolean(process.env.RELAYLAB_DB_HOST);

describe.skipIf(!configured)("lecturer MySQL, live", () => {
  it("creates, runs, reads, and deletes with the same contract as SQLite", async () => {
    const database = openDatabaseFromEnvironment({ sqlitePath: ":memory:" });
    try {
      const experiment = await database.createExperiment({
        name: "Live adapter check", behavior: "unavailable", payload: { orderId: "LIVE-1" },
      });
      expect(experiment.id).toBeGreaterThan(0);
      expect(experiment.createdAt).toMatch(/Z$/);

      const run = await database.createRun({
        experimentId: experiment.id,
        outcome: "downstream_error",
        httpStatus: 200,
        rpcErrorCode: -32001,
        idempotencyKey: null,
        durationMs: 7,
        response: { jsonrpc: "2.0", id: "live", error: { code: -32001, message: "Dependency unavailable" } },
      });
      expect(run.rpcErrorCode).toBe(-32001);

      // A plain-text response must read back intact from the JSON column.
      const text = await database.createRun({
        experimentId: experiment.id,
        outcome: "invalid_response",
        httpStatus: 200,
        rpcErrorCode: null,
        idempotencyKey: null,
        durationMs: 3,
        response: "<html>502 Bad Gateway</html>",
      });
      expect(text.response).toBe("<html>502 Bad Gateway</html>");

      const details = await database.getExperiment(experiment.id);
      expect(details?.runs.map((entry) => entry.outcome)).toEqual(["invalid_response", "downstream_error"]);

      expect(await database.deleteExperiment(experiment.id)).toBe(true);
      expect(await database.getExperiment(experiment.id)).toBeUndefined();
      expect(await database.deleteExperiment(experiment.id)).toBe(false);
    } finally {
      await database.close();
    }
  });
});
