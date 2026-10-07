import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SqliteDatabase from "better-sqlite3";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import {
  buildMySqlPoolOptions,
  createMySqlDatabase,
  readSchema,
  schemaStatements,
  useUtcSessions,
} from "../src/database.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readQuery = (name: string) =>
  readFileSync(path.join(ROOT, "database/queries", name), "utf8").replace(/;\s*$/, "");

const experimentRow = {
  id: 7,
  name: "Checkout",
  behavior: "healthy",
  payload_json: { orderId: "ORDER-7" },
  created_at: "2026-09-17 06:00:00",
};

const runRow = {
  id: 11,
  experiment_id: 7,
  outcome: "success",
  http_status: 200,
  rpc_error_code: null,
  duration_ms: 12,
  response_json: { jsonrpc: "2.0" },
  created_at: "2026-09-17 06:00:01",
};

const reviewRow = {
  ...runRow, review_id: 7, researcher_id: "researcher-a", status: "pending",
  feedback: null, reviewer_id: null, submitted_at: "2026-10-08 00:00:00", decided_at: null,
  experiment_name: "Checkout",
};

function fakeMySql({ failOn, affectedRows = 1 }: { failOn?: RegExp; affectedRows?: number } = {}) {
  const calls: string[] = [];
  const connection = {
    beginTransaction: vi.fn(async () => { calls.push("BEGIN"); }),
    execute: vi.fn(async (sql: string) => {
      const verb = sql.trim().split(/\s+/)[0].toUpperCase();
      calls.push(verb);
      if (failOn?.test(sql)) throw new Error("Connection lost");
      if (verb === "INSERT") return [{ insertId: 7 }];
      if (verb === "UPDATE") return [{ affectedRows }];
      return [[sql.includes("run_reviews") ? reviewRow : sql.includes("experiment_runs") ? runRow : experimentRow]];
    }),
    commit: vi.fn(async () => { calls.push("COMMIT"); }),
    rollback: vi.fn(async () => { calls.push("ROLLBACK"); }),
    release: vi.fn(() => { calls.push("RELEASE"); }),
  };
  const schema: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => { schema.push(sql); return [[]]; }),
    execute: vi.fn(),
    getConnection: vi.fn(async () => connection),
    end: vi.fn(async () => undefined),
  };
  return { database: createMySqlDatabase(pool as unknown as Pool), connection, pool, calls, schema };
}

const runInput = {
  experimentId: 7,
  outcome: "success" as const,
  httpStatus: 200,
  rpcErrorCode: null,
  idempotencyKey: null,
  durationMs: 12,
  response: { jsonrpc: "2.0" },
};

describe("MySQL writes", () => {
  it("submits review evidence atomically and rolls it back when read-back fails", async () => {
    const success = fakeMySql();
    expect(await success.database.createReview(11, "researcher-a")).toMatchObject({ id: 7, runId: 11, status: "pending", run: { outcome: "success" } });
    expect(success.calls).toEqual(["BEGIN", "INSERT", "SELECT", "COMMIT", "RELEASE"]);
    const failure = fakeMySql({ failOn: /^\s*SELECT/ });
    await expect(failure.database.createReview(11, "researcher-a")).rejects.toThrow("Connection lost");
    expect(failure.calls).toEqual(["BEGIN", "INSERT", "SELECT", "ROLLBACK", "RELEASE"]);
  });

  it("does not read back or overwrite a review when another decision has won", async () => {
    const { database, calls, connection } = fakeMySql({ affectedRows: 0 });
    expect(await database.decideReview(7, "approved", "Evidence verified", "reviewer")).toBeUndefined();
    expect(calls).toEqual(["BEGIN", "UPDATE", "COMMIT", "RELEASE"]);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining("AND status = 'pending'"), ["approved", "Evidence verified", "reviewer", 7]);
  });

  it("rolls a decision back when its read-back is unavailable", async () => {
    const { database, calls } = fakeMySql({ failOn: /^\s*SELECT/ });
    await expect(database.decideReview(7, "rejected", "Rerun needed", "reviewer")).rejects.toThrow("Connection lost");
    expect(calls).toEqual(["BEGIN", "UPDATE", "SELECT", "ROLLBACK", "RELEASE"]);
  });
  it("commits an insert and its read-back on one pooled connection", async () => {
    const { database, calls, pool } = fakeMySql();

    const run = await database.createRun(runInput);

    expect(calls).toEqual(["BEGIN", "INSERT", "SELECT", "COMMIT", "RELEASE"]);
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ id: 11, experimentId: 7, createdAt: "2026-09-17T06:00:01.000Z" });
  });

  it("rolls the insert back when the read-back fails, so a 503 never hides a saved run", async () => {
    const { database, calls, connection } = fakeMySql({ failOn: /^\s*SELECT/ });

    await expect(database.createRun(runInput)).rejects.toThrow("Connection lost");

    expect(calls).toEqual(["BEGIN", "INSERT", "SELECT", "ROLLBACK", "RELEASE"]);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rolls back a rejected experiment insert and still releases the connection", async () => {
    const { database, calls } = fakeMySql({ failOn: /^\s*INSERT/ });

    await expect(database.createExperiment({
      name: "Checkout",
      behavior: "healthy",
      payload: {},
    })).rejects.toThrow("Connection lost");

    expect(calls).toEqual(["BEGIN", "INSERT", "ROLLBACK", "RELEASE"]);
  });

  it("applies the submitted MySQL schema script before the first write", async () => {
    const { database, schema } = fakeMySql();

    await database.createExperiment({ name: "Checkout", behavior: "healthy", payload: {} });

    const script = schemaStatements(readSchema("schema.mysql.sql"));
    expect(schema.slice(0, script.length)).toEqual(script);
    expect(script).toHaveLength(3);
    expect(script[1]).toContain("FOREIGN KEY (experiment_id)");
    expect(script[2]).toContain("REFERENCES experiment_runs(id) ON DELETE RESTRICT");
    // Then the migration check for databases created before rpc_error_code.
    expect(schema[script.length]).toContain("information_schema.COLUMNS");
  });

  it("reads back a plain-text response that MySQL returns already unwrapped", async () => {
    const textRow = { ...runRow, response_json: "<html>502 Bad Gateway</html>" };
    const pool = {
      query: vi.fn(async () => [[]]),
      execute: vi.fn(async (sql: string) =>
        sql.includes("experiment_runs") ? [[textRow]] : [[experimentRow]]),
      getConnection: vi.fn(),
      end: vi.fn(),
    };
    const database = createMySqlDatabase(pool as unknown as Pool);

    const details = await database.getExperiment(7);

    expect(details?.runs[0]?.response).toBe("<html>502 Bad Gateway</html>");
  });

  it("puts every pooled MySQL session in UTC and keeps idle connections alive", () => {
    const events = new EventEmitter();
    const session = { query: vi.fn() };
    useUtcSessions({ pool: events } as unknown as Pool);

    events.emit("connection", session);

    expect(session.query).toHaveBeenCalledWith("SET time_zone = '+00:00'", expect.any(Function));
    expect(buildMySqlPoolOptions({
      host: "database.example.test",
      port: 3306,
      database: "student_schema",
      user: "student_user",
      password: "local-secret",
    })).toMatchObject({ connectionLimit: 5, enableKeepAlive: true });
  });
});

describe("shipped reporting queries", () => {
  it("run against the schema they are written for", () => {
    const database = new SqliteDatabase(":memory:");
    database.exec(readSchema("schema.sqlite.sql"));
    database.prepare("INSERT INTO experiments (name, behavior, payload_json) VALUES (?, ?, ?)")
      .run("Reported", "healthy", "{}");
    database.prepare(
      "INSERT INTO experiment_runs (experiment_id, outcome, http_status, rpc_error_code, duration_ms) VALUES (?, ?, ?, ?, ?)",
    ).run(1, "downstream_error", 200, -32001, 3);

    const counts = database.prepare(readQuery("counts.sql")).get();
    const outcomes = database.prepare(readQuery("runs-by-outcome.sql")).all();

    expect(counts).toEqual({ experiments: 1, runs: 1 });
    expect(outcomes).toEqual([{ outcome: "downstream_error", runs: 1 }]);
    database.close();
  });
});

describe("SQLite schema script", () => {
  it("is idempotent, enforces the foreign key, and indexes run history by experiment", () => {
    const database = new SqliteDatabase(":memory:");
    database.pragma("foreign_keys = ON");
    database.exec(readSchema("schema.sqlite.sql"));
    database.exec(readSchema("schema.sqlite.sql"));

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'experiment_runs' ORDER BY name")
      .all();
    expect(indexes).toEqual([
      { name: "idx_experiment_runs_experiment" },
      { name: "idx_experiment_runs_key" },
      { name: "idx_experiment_runs_outcome" },
    ]);
    expect(() => database
      .prepare("INSERT INTO experiment_runs (experiment_id, outcome, duration_ms) VALUES (99, 'success', 1)")
      .run()).toThrow(/FOREIGN KEY/);
    database.close();
  });
});
