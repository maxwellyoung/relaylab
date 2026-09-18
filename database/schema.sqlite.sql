-- RelayLab schema for the credential-free SQLite lane.
-- The coordinator applies this file on startup; every statement is idempotent.

CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  behavior TEXT NOT NULL
    CHECK (behavior IN ('healthy', 'slow', 'unavailable', 'malformed')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id INTEGER NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('success', 'downstream_error', 'timeout',
                       'invalid_response', 'unreachable')),
  http_status INTEGER,
  rpc_error_code INTEGER,
  duration_ms INTEGER NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (experiment_id)
    REFERENCES experiments(id)
    ON DELETE CASCADE
);

-- SQLite does not index foreign keys automatically; run history is read by experiment.
CREATE INDEX IF NOT EXISTS idx_experiment_runs_experiment
  ON experiment_runs (experiment_id, id);

-- Runs are also counted and filtered by outcome.
CREATE INDEX IF NOT EXISTS idx_experiment_runs_outcome
  ON experiment_runs (outcome);
