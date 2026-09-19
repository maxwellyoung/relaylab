import SqliteDatabase from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

export const MAX_DATABASE_CONNECTIONS = 5;

const schemaDirectory = new URL("../../database/", import.meta.url);

export function readSchema(fileName: "schema.sqlite.sql" | "schema.mysql.sql"): string {
  return readFileSync(new URL(fileName, schemaDirectory), "utf8");
}

export function schemaStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export const experimentBehaviors = [
  "healthy",
  "slow",
  "unavailable",
  "malformed",
] as const;

export type ExperimentBehavior = (typeof experimentBehaviors)[number];

export type Experiment = {
  id: number;
  name: string;
  behavior: ExperimentBehavior;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RunOutcome =
  | "success"
  | "downstream_error"
  | "timeout"
  | "invalid_response"
  | "unreachable";

export type ExperimentRun = {
  id: number;
  experimentId: number;
  outcome: RunOutcome;
  httpStatus: number | null;
  rpcErrorCode: number | null;
  durationMs: number;
  response: Record<string, unknown> | string | null;
  createdAt: string;
};

export type ExperimentDetails = Experiment & {
  runs: ExperimentRun[];
};

type ExperimentRow = {
  id: number;
  name: string;
  behavior: ExperimentBehavior;
  payload_json: string | Record<string, unknown>;
  created_at: string | Date;
};

type ExperimentRunRow = {
  id: number;
  experiment_id: number;
  outcome: RunOutcome;
  http_status: number | null;
  rpc_error_code: number | null;
  duration_ms: number;
  response_json: string | Record<string, unknown> | null;
  created_at: string | Date;
};

type MySqlExperimentRow = ExperimentRow & RowDataPacket;
type MySqlExperimentRunRow = ExperimentRunRow & RowDataPacket;

function parseJsonObject(value: string | Record<string, unknown>) {
  return typeof value === "string"
    ? (JSON.parse(value) as Record<string, unknown>)
    : value;
}

function parseJsonResponse(
  value: string | Record<string, unknown> | null,
): Record<string, unknown> | string | null {
  if (value === null) return null;
  // MySQL hands a JSON column back already parsed, so a stored plain-text
  // response arrives as a bare string. Returning it beats failing the read.
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as Record<string, unknown> | string;
  } catch {
    return value;
  }
}

function normalizeTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (value.includes("T")) return value;
  return new Date(`${value.replace(" ", "T")}Z`).toISOString();
}

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    behavior: row.behavior,
    payload: parseJsonObject(row.payload_json),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function toExperimentRun(row: ExperimentRunRow): ExperimentRun {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    outcome: row.outcome,
    httpStatus: row.http_status,
    rpcErrorCode: row.rpc_error_code ?? null,
    durationMs: row.duration_ms,
    response: parseJsonResponse(row.response_json),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export type RelayLabDatabase = {
  createExperiment(
    input: Omit<Experiment, "id" | "createdAt">,
  ): Promise<Experiment>;
  listExperiments(): Promise<Experiment[]>;
  getExperiment(experimentId: number): Promise<ExperimentDetails | undefined>;
  createRun(
    input: Omit<ExperimentRun, "id" | "createdAt">,
  ): Promise<ExperimentRun>;
  deleteExperiment(experimentId: number): Promise<boolean>;
  close(): Promise<void>;
};

export function openDatabase(databasePath: string): RelayLabDatabase {
  const database = new SqliteDatabase(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(readSchema("schema.sqlite.sql"));
  // A database created before rpc_error_code existed keeps its rows; add the
  // column rather than requiring anyone to delete their data.
  const columns = database
    .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('experiment_runs')")
    .all()
    .map((column) => column.name);
  if (!columns.includes("rpc_error_code")) {
    database.exec("ALTER TABLE experiment_runs ADD COLUMN rpc_error_code INTEGER");
  }

  const insertExperiment = database.prepare<
    {
      name: string;
      behavior: ExperimentBehavior;
      payloadJson: string;
    },
    ExperimentRow
  >(`
    INSERT INTO experiments (
      name,
      behavior,
      payload_json
    ) VALUES (
      @name,
      @behavior,
      @payloadJson
    )
    RETURNING *
  `);

  const listExperiments = database.prepare<[], ExperimentRow>(`
    SELECT *
    FROM experiments
    ORDER BY id DESC
  `);

  const findExperiment = database.prepare<[number], ExperimentRow>(`
    SELECT *
    FROM experiments
    WHERE id = ?
  `);

  const insertRun = database.prepare<
    {
      experimentId: number;
      outcome: RunOutcome;
      httpStatus: number | null;
      rpcErrorCode: number | null;
      durationMs: number;
      responseJson: string | null;
    },
    ExperimentRunRow
  >(`
    INSERT INTO experiment_runs (
      experiment_id,
      outcome,
      http_status,
      rpc_error_code,
      duration_ms,
      response_json
    ) VALUES (
      @experimentId,
      @outcome,
      @httpStatus,
      @rpcErrorCode,
      @durationMs,
      @responseJson
    )
    RETURNING *
  `);

  const deleteExperiment = database.prepare<[number]>(`
    DELETE FROM experiments
    WHERE id = ?
  `);

  const listRuns = database.prepare<[number], ExperimentRunRow>(`
    SELECT *
    FROM experiment_runs
    WHERE experiment_id = ?
    ORDER BY id DESC
  `);

  return {
    async createExperiment(
      input: Omit<Experiment, "id" | "createdAt">,
    ): Promise<Experiment> {
      const row = insertExperiment.get({
        name: input.name,
        behavior: input.behavior,
        payloadJson: JSON.stringify(input.payload),
      });
      if (!row) {
        throw new Error("SQLite did not return the created experiment");
      }
      return toExperiment(row);
    },
    async listExperiments(): Promise<Experiment[]> {
      return listExperiments.all().map(toExperiment);
    },
    async getExperiment(
      experimentId: number,
    ): Promise<ExperimentDetails | undefined> {
      const experiment = findExperiment.get(experimentId);
      if (!experiment) return undefined;

      return {
        ...toExperiment(experiment),
        runs: listRuns.all(experimentId).map(toExperimentRun),
      };
    },
    async createRun(
      input: Omit<ExperimentRun, "id" | "createdAt">,
    ): Promise<ExperimentRun> {
      const row = insertRun.get({
        experimentId: input.experimentId,
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        rpcErrorCode: input.rpcErrorCode,
        durationMs: input.durationMs,
        responseJson:
          input.response === null ? null : JSON.stringify(input.response),
      });
      if (!row) {
        throw new Error("SQLite did not return the created experiment run");
      }
      return toExperimentRun(row);
    },
    async deleteExperiment(experimentId: number): Promise<boolean> {
      // Foreign keys are on, so the experiment's runs cascade with it.
      return deleteExperiment.run(experimentId).changes > 0;
    },
    async close() {
      database.close();
    },
  };
}

export type MySqlDatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: PoolOptions["ssl"];
};

export function buildMySqlPoolOptions(
  config: MySqlDatabaseConfig,
): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    waitForConnections: true,
    connectionLimit: MAX_DATABASE_CONNECTIONS,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // Fail visibly instead of queueing for ever if the shared server stalls.
    queueLimit: 20,
    connectTimeout: 10_000,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
  };
}

export function openMySqlDatabase(
  config: MySqlDatabaseConfig,
): RelayLabDatabase {
  const pool = createPool(buildMySqlPoolOptions(config));
  useUtcSessions(pool);
  return createMySqlDatabase(pool);
}

// TIMESTAMP values are read back as strings and treated as UTC, so every pooled
// session must use UTC whatever the server's default time zone is.
export function useUtcSessions(pool: Pool): void {
  pool.pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'", () => undefined);
  });
}

export function createMySqlDatabase(pool: Pool): RelayLabDatabase {
  const initialized = (async () => {
    for (const statement of schemaStatements(readSchema("schema.mysql.sql"))) {
      await pool.query(statement);
    }
    // Same migration as SQLite: an existing schema keeps its rows and gains the column.
    const [columns] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'experiment_runs'
         AND COLUMN_NAME = 'rpc_error_code'`,
    );
    if (columns.length === 0) {
      await pool.query("ALTER TABLE experiment_runs ADD COLUMN rpc_error_code INT NULL AFTER http_status");
    }
    // MySQL has no CREATE INDEX IF NOT EXISTS, and a schema created before the
    // keys were declared inline needs them added.
    for (const [name, columns] of [
      ["idx_experiment_runs_outcome", "(outcome)"],
      ["idx_experiment_runs_experiment", "(experiment_id, id)"],
    ] as const) {
      const [indexes] = await pool.query<RowDataPacket[]>(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'experiment_runs'
           AND INDEX_NAME = ?`,
        [name],
      );
      if (indexes.length === 0) {
        await pool.query(`CREATE INDEX ${name} ON experiment_runs ${columns}`);
      }
    }
  })();
  // Attach a rejection handler immediately so unavailable credentials or a
  // sleeping server cannot become an unhandled startup rejection. Callers
  // still await the original promise and receive the same failure.
  void initialized.catch(() => undefined);

  // MySQL cannot return an inserted row from the INSERT itself. The insert and
  // its read-back share one transaction on one connection, so a failed
  // read-back rolls the insert back and a 503 never hides a saved row.
  async function inTransaction<T>(
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    await initialized;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getExperiment(
    experimentId: number,
  ): Promise<ExperimentDetails | undefined> {
    await initialized;
    const [experimentRows] = await pool.execute<MySqlExperimentRow[]>(
      "SELECT * FROM experiments WHERE id = ?",
      [experimentId],
    );
    const experiment = experimentRows[0];
    if (!experiment) return undefined;

    const [runRows] = await pool.execute<MySqlExperimentRunRow[]>(
      `SELECT * FROM experiment_runs
       WHERE experiment_id = ?
       ORDER BY id DESC`,
      [experimentId],
    );
    return {
      ...toExperiment(experiment),
      runs: runRows.map(toExperimentRun),
    };
  }

  return {
    createExperiment(input) {
      return inTransaction(async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO experiments (name, behavior, payload_json)
           VALUES (?, ?, ?)`,
          [input.name, input.behavior, JSON.stringify(input.payload)],
        );
        const [rows] = await connection.execute<MySqlExperimentRow[]>(
          "SELECT * FROM experiments WHERE id = ?",
          [result.insertId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error("MySQL did not return the created experiment");
        }
        return toExperiment(row);
      });
    },
    async listExperiments() {
      await initialized;
      const [rows] = await pool.query<MySqlExperimentRow[]>(
        "SELECT * FROM experiments ORDER BY id DESC",
      );
      return rows.map(toExperiment);
    },
    getExperiment,
    createRun(input) {
      return inTransaction(async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO experiment_runs (
             experiment_id,
             outcome,
             http_status,
             rpc_error_code,
             duration_ms,
             response_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            input.experimentId,
            input.outcome,
            input.httpStatus,
            input.rpcErrorCode,
            input.durationMs,
            input.response === null ? null : JSON.stringify(input.response),
          ],
        );
        const [rows] = await connection.execute<MySqlExperimentRunRow[]>(
          "SELECT * FROM experiment_runs WHERE id = ?",
          [result.insertId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error("MySQL did not return the created experiment run");
        }
        return toExperimentRun(row);
      });
    },
    async deleteExperiment(experimentId) {
      await initialized;
      const [result] = await pool.execute<ResultSetHeader>(
        "DELETE FROM experiments WHERE id = ?",
        [experimentId],
      );
      return result.affectedRows > 0;
    },
    async close() {
      await initialized.catch(() => undefined);
      await pool.end();
    },
  };
}

type DatabaseEnvironment = Record<string, string | undefined>;

function requiredEnvironmentValue(
  environment: DatabaseEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when RELAYLAB_DATABASE_DRIVER=mysql`);
  }
  return value;
}

export function mySqlSslFromEnvironment(
  environment: DatabaseEnvironment,
): MySqlDatabaseConfig["ssl"] {
  if (environment.RELAYLAB_DB_SSL !== "true") return undefined;
  const caPath = environment.RELAYLAB_DB_SSL_CA?.trim();
  if (!caPath) return { rejectUnauthorized: true };
  // A relative bundle path is taken from the project root, so the setting
  // works the same whether a process starts from the root or a workspace.
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(projectRoot, caPath);
  return { rejectUnauthorized: true, ca: readFileSync(resolved, "utf8") };
}

export function openDatabaseFromEnvironment({
  sqlitePath,
  environment = process.env,
}: {
  sqlitePath: string;
  environment?: DatabaseEnvironment;
}): RelayLabDatabase {
  const driver = environment.RELAYLAB_DATABASE_DRIVER?.trim().toLowerCase()
    ?? "sqlite";
  if (driver === "sqlite") return openDatabase(sqlitePath);
  if (driver !== "mysql") {
    throw new Error(
      `Unsupported RELAYLAB_DATABASE_DRIVER: ${driver}`,
    );
  }

  const port = Number(environment.RELAYLAB_DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("RELAYLAB_DB_PORT must be a valid TCP port");
  }

  return openMySqlDatabase({
    host: requiredEnvironmentValue(environment, "RELAYLAB_DB_HOST"),
    port,
    database: requiredEnvironmentValue(environment, "RELAYLAB_DB_NAME"),
    user: requiredEnvironmentValue(environment, "RELAYLAB_DB_USER"),
    password: requiredEnvironmentValue(environment, "RELAYLAB_DB_PASSWORD"),
    ssl: mySqlSslFromEnvironment(environment),
  });
}
