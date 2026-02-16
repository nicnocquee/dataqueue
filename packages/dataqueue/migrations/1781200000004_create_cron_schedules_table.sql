-- Create cron_schedules table for recurring job definitions

-- Up Migration
CREATE TABLE IF NOT EXISTS cron_schedules (
  id SERIAL PRIMARY KEY,
  schedule_name VARCHAR(255) NOT NULL UNIQUE,
  cron_expression VARCHAR(255) NOT NULL,
  job_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  max_attempts INT DEFAULT 3,
  priority INT DEFAULT 0,
  timeout_ms INT,
  force_kill_on_timeout BOOLEAN DEFAULT FALSE,
  tags TEXT[],
  timezone VARCHAR(100) DEFAULT 'UTC',
  allow_overlap BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) DEFAULT 'active',
  last_enqueued_at TIMESTAMPTZ,
  last_job_id INT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cron_schedules_status ON cron_schedules(status);
CREATE INDEX IF NOT EXISTS idx_cron_schedules_next_run_at ON cron_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS idx_cron_schedules_name ON cron_schedules(schedule_name);

-- Down Migration
DROP INDEX IF EXISTS idx_cron_schedules_name;
DROP INDEX IF EXISTS idx_cron_schedules_next_run_at;
DROP INDEX IF EXISTS idx_cron_schedules_status;
DROP TABLE IF EXISTS cron_schedules;
