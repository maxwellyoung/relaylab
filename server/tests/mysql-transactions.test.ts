import { EventEmitter } from "node:events";
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
  duration_ms: 12,
  response_json: { jsonrpc: "2.0" },
  created_at: "2026-09-17 06:00:01",
};

function fakeMySql({ failOn }: { failOn?: RegExp } = {}) {
  const calls: string[] = [];
  const connection = {
    beginTransaction: vi.fn(async () => { calls.push("BEGIN"); }),
    execute: vi.fn(async (sql: string) => {
      const verb = sql.trim().split(/\s+/)[0].toUpperCase();
      calls.push(verb);
      if (failOn?.test(sql)) throw new Error("Connection lost");
      if (verb === "INSERT") return [{ insertId: 7 }];
      return [[sql.includes("experiment_runs") ? runRow : experimentRow]];
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
  durationMs: 12,
  response: { jsonrpc: "2.0" },
};

describe("MySQL writes", () => {
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

    expect(schema).toEqual(schemaStatements(readSchema("schema.mysql.sql")));
    expect(schema).toHaveLength(2);
    expect(schema[1]).toContain("FOREIGN KEY (experiment_id)");
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

describe("SQLite schema script", () => {
  it("is idempotent, enforces the foreign key, and indexes run history by experiment", () => {
    const database = new SqliteDatabase(":memory:");
    database.pragma("foreign_keys = ON");
    database.exec(readSchema("schema.sqlite.sql"));
    database.exec(readSchema("schema.sqlite.sql"));

    const index = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'experiment_runs'")
      .all();
    expect(index).toEqual([{ name: "idx_experiment_runs_experiment" }]);
    expect(() => database
      .prepare("INSERT INTO experiment_runs (experiment_id, outcome, duration_ms) VALUES (99, 'success', 1)")
      .run()).toThrow(/FOREIGN KEY/);
    database.close();
  });
});
