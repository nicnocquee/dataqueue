-- 001-initial.sql: Initial schema for pg-bg-job-queue

-- Up Migration
CREATE TABLE IF NOT EXISTS job_queue (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  priority INT DEFAULT 0,
  run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  pending_reason TEXT,
  error_history JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_queue_next_attempt ON job_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_run_at ON job_queue(run_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_priority ON job_queue(priority);

-- Down Migration
DROP INDEX IF EXISTS idx_job_queue_priority;
DROP INDEX IF EXISTS idx_job_queue_run_at;
DROP INDEX IF EXISTS idx_job_queue_next_attempt;
DROP INDEX IF EXISTS idx_job_queue_status;
DROP TABLE IF EXISTS job_queue; 
