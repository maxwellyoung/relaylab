import SqliteDatabase from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import type { ExecuteRunRequest, Execution } from "../../protocol/runner.mjs";

type Row = {
  execution_id: string; operation_id: string; experiment_ref: string;
  fingerprint: string; state: Execution["state"]; outcome: string;
  result_json: string; started_at: string; completed_at: string;
};
function execution(row: Row): Execution {
  return {
    executionId: row.execution_id, operationId: row.operation_id, experimentRef: row.experiment_ref,
    state: row.state, outcome: row.outcome, resultJson: row.result_json,
    startedAt: row.started_at, completedAt: row.completed_at,
  };
}

export function openExecutionStore(databasePath: string) {
  // Acquire ownership before startup recovery changes any RUNNING records.
  // A second live runner must not mark the first runner's work interrupted.
  const leasePath = `${databasePath}.lock`;
  const lease = JSON.stringify({ pid: process.pid, owner: randomUUID() });
  function release() {
    if (databasePath === ":memory:") return;
    try { if (readFileSync(leasePath, "utf8") === lease) unlinkSync(leasePath); } catch {}
  }
  if (databasePath !== ":memory:") {
    const guardPath = `${leasePath}.guard`;
    // Serialize stale-lease reclamation as well as fresh acquisition. A guard
    // left by a crash during startup is deliberately an inspection gate.
    const guard = openSync(guardPath, "wx", 0o600);
    try { writeFileSync(guard, lease); } finally { closeSync(guard); }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const file = openSync(leasePath, "wx", 0o600);
          try { writeFileSync(file, lease); } finally { closeSync(file); }
          break;
        } catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST" || attempt !== 0) throw error;
          const previous = readFileSync(leasePath, "utf8");
          let pid: number;
          try { pid = Number(JSON.parse(previous).pid); } catch { throw new Error("Execution ledger has an unreadable ownership lease; inspect it before recovery"); }
          if (!Number.isInteger(pid) || pid <= 0) throw new Error("Execution ledger has an invalid ownership lease");
          try { process.kill(pid, 0); throw new Error("Execution ledger is already owned by a running runner"); }
          catch (reason) {
            if (!reason || typeof reason !== "object" || !("code" in reason) || reason.code !== "ESRCH") throw reason;
          }
          if (readFileSync(leasePath, "utf8") !== previous) throw new Error("Execution ledger ownership changed during recovery");
          unlinkSync(leasePath);
        }
      }
    } finally {
      if (readFileSync(guardPath, "utf8") === lease) unlinkSync(guardPath);
    }
  }
  let database: SqliteDatabase.Database;
  try { database = new SqliteDatabase(databasePath); } catch (error) { release(); throw error; }
  let lookup: SqliteDatabase.Statement<[string], Row>;
  try {
    database.pragma("journal_mode = WAL");
    database.exec(`CREATE TABLE IF NOT EXISTS executions (
      execution_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      experiment_ref TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      behavior TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('RUNNING', 'COMPLETED', 'INTERRUPTED')),
      outcome TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    )`);
    // One runner instance owns this ledger. After a crash, do not silently
    // repeat work with uncertain side effects under the same operation ID.
    database.prepare(`UPDATE executions SET state = 'INTERRUPTED', completed_at = ?,
      result_json = ? WHERE state = 'RUNNING'`).run(new Date().toISOString(), JSON.stringify({ error: "Runner restarted before completion; inspect and start a new operation." }));

    lookup = database.prepare<[string], Row>("SELECT * FROM executions WHERE operation_id = ?");
  } catch (error) {
    database.close(); release(); throw error;
  }
  return {
    find(operationId: string) { const row = lookup.get(operationId); return row ? { ...execution(row), fingerprint: row.fingerprint } : undefined; },
    start(request: ExecuteRunRequest, fingerprint: string) {
      const executionId = randomUUID();
      database.prepare(`INSERT INTO executions (execution_id, operation_id, experiment_ref, fingerprint, behavior, payload_json, state, started_at)
        VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?)`).run(executionId, request.operationId, request.experimentRef, fingerprint, request.behavior, request.payloadJson, new Date().toISOString());
      return execution(lookup.get(request.operationId)!);
    },
    complete(operationId: string, outcome: string, result: unknown) {
      database.prepare(`UPDATE executions SET state = 'COMPLETED', outcome = ?, result_json = ?, completed_at = ?
        WHERE operation_id = ? AND state = 'RUNNING'`).run(outcome, JSON.stringify(result), new Date().toISOString(), operationId);
      return execution(lookup.get(operationId)!);
    },
    close() { try { database.close(); } finally { release(); } },
  };
}
