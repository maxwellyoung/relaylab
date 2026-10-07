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
  idempotency_key TEXT,
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

-- A repeated request carries the same key; the coordinator looks it up here.
CREATE INDEX IF NOT EXISTS idx_experiment_runs_key
  ON experiment_runs (experiment_id, idempotency_key);

-- Review decisions are independent of execution outcomes. Submitted evidence
-- cannot be deleted through the baseline experiment-delete operation.
CREATE TABLE IF NOT EXISTS run_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL UNIQUE REFERENCES experiment_runs(id) ON DELETE RESTRICT,
  researcher_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  feedback TEXT,
  reviewer_id TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  CHECK ((status = 'pending' AND feedback IS NULL AND reviewer_id IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND feedback IS NOT NULL AND length(trim(feedback)) > 0 AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_run_reviews_researcher ON run_reviews (researcher_id, id);
