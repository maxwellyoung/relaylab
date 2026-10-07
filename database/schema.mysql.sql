-- RelayLab schema for the lecturer-provided MySQL server (InnoDB).
-- The coordinator applies this file on startup; every statement is idempotent.
-- InnoDB creates an index for the experiment_runs foreign key automatically.

CREATE TABLE IF NOT EXISTS experiments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  behavior VARCHAR(32) NOT NULL
    CHECK (behavior IN ('healthy', 'slow', 'unavailable', 'malformed')),
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS experiment_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT UNSIGNED NOT NULL,
  outcome VARCHAR(32) NOT NULL
    CHECK (outcome IN ('success', 'downstream_error', 'timeout',
                       'invalid_response', 'unreachable')),
  http_status SMALLINT NULL,
  rpc_error_code INT NULL,
  idempotency_key VARCHAR(80) NULL,
  duration_ms INT UNSIGNED NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_experiment_runs_experiment (experiment_id, id),
  KEY idx_experiment_runs_outcome (outcome),
  KEY idx_experiment_runs_key (experiment_id, idempotency_key),
  CONSTRAINT fk_experiment_runs_experiment
    FOREIGN KEY (experiment_id)
    REFERENCES experiments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- The coordinator owns reviews. Preserve submitted run evidence on deletion.
CREATE TABLE IF NOT EXISTS run_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL UNIQUE,
  researcher_id VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  feedback VARCHAR(2000) NULL,
  reviewer_id VARCHAR(32) NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP NULL,
  KEY idx_run_reviews_researcher (researcher_id, id),
  CONSTRAINT fk_run_reviews_run FOREIGN KEY (run_id) REFERENCES experiment_runs(id) ON DELETE RESTRICT,
  CHECK ((status = 'pending' AND feedback IS NULL AND reviewer_id IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND feedback IS NOT NULL AND CHAR_LENGTH(TRIM(feedback)) > 0 AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL))
) ENGINE=InnoDB;
