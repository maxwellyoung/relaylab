import Database from "better-sqlite3";

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
  payload_json: string;
  created_at: string;
};

type ExperimentRunRow = {
  id: number;
  experiment_id: number;
  outcome: RunOutcome;
  http_status: number | null;
  duration_ms: number;
  response_json: string | null;
  created_at: string;
};

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    behavior: row.behavior,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function toExperimentRun(row: ExperimentRunRow): ExperimentRun {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    outcome: row.outcome,
    httpStatus: row.http_status,
    durationMs: row.duration_ms,
    response:
      row.response_json === null
        ? null
        : (JSON.parse(row.response_json) as
            | Record<string, unknown>
            | string),
    createdAt: row.created_at,
  };
}

export function openDatabase(databasePath: string) {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      behavior TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS experiment_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      http_status INTEGER,
      duration_ms INTEGER NOT NULL,
      response_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (experiment_id)
        REFERENCES experiments(id)
        ON DELETE CASCADE
    );
  `);

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
      durationMs: number;
      responseJson: string | null;
    },
    ExperimentRunRow
  >(`
    INSERT INTO experiment_runs (
      experiment_id,
      outcome,
      http_status,
      duration_ms,
      response_json
    ) VALUES (
      @experimentId,
      @outcome,
      @httpStatus,
      @durationMs,
      @responseJson
    )
    RETURNING *
  `);

  const listRuns = database.prepare<[number], ExperimentRunRow>(`
    SELECT *
    FROM experiment_runs
    WHERE experiment_id = ?
    ORDER BY id DESC
  `);

  return {
    createExperiment(
      input: Omit<Experiment, "id" | "createdAt">,
    ): Experiment {
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
    listExperiments(): Experiment[] {
      return listExperiments.all().map(toExperiment);
    },
    getExperiment(experimentId: number): ExperimentDetails | undefined {
      const experiment = findExperiment.get(experimentId);
      if (!experiment) return undefined;

      return {
        ...toExperiment(experiment),
        runs: listRuns.all(experimentId).map(toExperimentRun),
      };
    },
    createRun(
      input: Omit<ExperimentRun, "id" | "createdAt">,
    ): ExperimentRun {
      const row = insertRun.get({
        experimentId: input.experimentId,
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        durationMs: input.durationMs,
        responseJson:
          input.response === null ? null : JSON.stringify(input.response),
      });
      if (!row) {
        throw new Error("SQLite did not return the created experiment run");
      }
      return toExperimentRun(row);
    },
    close() {
      database.close();
    },
  };
}

export type RelayLabDatabase = ReturnType<typeof openDatabase>;
