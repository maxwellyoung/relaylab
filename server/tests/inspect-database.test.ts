import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("npm run db:inspect", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("prints the related rows and the outcome counts from SQLite", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "relaylab-inspect-"));
    const database = openDatabase(path.join(directory, "relaylab.sqlite"));
    const experiment = await database.createExperiment({
      name: "Inspect check", behavior: "unavailable", payload: { orderId: "ORDER-5" },
    });
    await database.createRun({
      experimentId: experiment.id, outcome: "downstream_error", httpStatus: 200,
      rpcErrorCode: -32001, durationMs: 4, response: { jsonrpc: "2.0" },
    });
    await database.createRun({
      experimentId: experiment.id, outcome: "success", httpStatus: 200,
      rpcErrorCode: null, durationMs: 9, response: { jsonrpc: "2.0" },
    });
    await database.close();

    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/inspect-database.mjs")], {
      cwd: ROOT,
      env: { ...process.env, RELAYLAB_DATA_DIR: directory, RELAYLAB_DATABASE_DRIVER: "sqlite" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SQLite: 1 experiments, 2 experiment_runs");
    expect(result.stdout).toContain("downstream_error=1");
    expect(result.stdout).toContain("success=1");
    expect(result.stdout).toContain("Inspect check");
    expect(result.stdout).toContain("-32001");
  });
});
