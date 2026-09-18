// Prints the two related tables straight from the configured database (SQLite or MySQL)
// without printing any connection settings. Run after `npm run build`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import SqliteDatabase from "better-sqlite3";
import { createConnection } from "mysql2/promise";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limit = Number(process.argv[2] ?? 8);

const countsSql = `
  SELECT (SELECT COUNT(*) FROM experiments) AS experiments,
         (SELECT COUNT(*) FROM experiment_runs) AS runs`;
const outcomesSql = `
  SELECT outcome, COUNT(*) AS runs
  FROM experiment_runs
  GROUP BY outcome
  ORDER BY runs DESC, outcome`;
const runsSql = `
  SELECT r.id AS run, r.experiment_id AS experiment, e.name, r.outcome,
         r.http_status AS http, r.rpc_error_code AS rpc_error, r.duration_ms AS ms,
         r.created_at
  FROM experiment_runs r
  JOIN experiments e ON e.id = r.experiment_id
  ORDER BY r.id DESC
  LIMIT ${Number.isInteger(limit) && limit > 0 ? limit : 8}`;

async function query() {
  const driver = (process.env.RELAYLAB_DATABASE_DRIVER ?? "sqlite").trim().toLowerCase();
  if (driver === "mysql") {
    // Only the MySQL lane needs the built server, so load it lazily.
    const { mySqlSslFromEnvironment } = await import("../server/dist/database.js");
    const connection = await createConnection({
      host: process.env.RELAYLAB_DB_HOST,
      port: Number(process.env.RELAYLAB_DB_PORT ?? 3306),
      database: process.env.RELAYLAB_DB_NAME,
      user: process.env.RELAYLAB_DB_USER,
      password: process.env.RELAYLAB_DB_PASSWORD,
      ssl: mySqlSslFromEnvironment(process.env),
      dateStrings: true,
    });
    try {
      const [[counts]] = await connection.query(countsSql);
      const [outcomes] = await connection.query(outcomesSql);
      const [runs] = await connection.query(runsSql);
      return { label: "MySQL", counts, outcomes, runs };
    } finally {
      await connection.end();
    }
  }

  const dataDirectory = process.env.RELAYLAB_DATA_DIR ?? path.join(rootDirectory, "data");
  const database = new SqliteDatabase(path.join(dataDirectory, "relaylab.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return {
      label: "SQLite",
      counts: database.prepare(countsSql).get(),
      outcomes: database.prepare(outcomesSql).all(),
      runs: database.prepare(runsSql).all(),
    };
  } finally {
    database.close();
  }
}

const { label, counts, outcomes, runs } = await query();
console.log(`${label}: ${counts.experiments} experiments, ${counts.runs} experiment_runs`);
console.log(`Runs by outcome: ${outcomes.map((row) => `${row.outcome}=${row.runs}`).join(", ") || "none"}`);
console.log("Latest runs joined to their experiment (experiment_runs.experiment_id -> experiments.id):");
console.table(runs);
