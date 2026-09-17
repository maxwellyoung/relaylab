-- RelayLab schema for the lecturer-provided MySQL server (InnoDB).
-- The coordinator applies this file on startup; every statement is idempotent.
-- InnoDB creates an index for the experiment_runs foreign key automatically.

CREATE TABLE IF NOT EXISTS experiments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  behavior VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS experiment_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT UNSIGNED NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  http_status SMALLINT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_experiment_runs_experiment
    FOREIGN KEY (experiment_id)
    REFERENCES experiments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
