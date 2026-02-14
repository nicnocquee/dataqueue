-- Up Migration: Create waitpoints table for token-based waits
CREATE TABLE IF NOT EXISTS waitpoints (
  id VARCHAR(255) PRIMARY KEY,
  job_id INT REFERENCES job_queue(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  output JSONB DEFAULT NULL,
  timeout_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  tags TEXT[] DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitpoints_job_id ON waitpoints(job_id);
CREATE INDEX IF NOT EXISTS idx_waitpoints_status ON waitpoints(status);
CREATE INDEX IF NOT EXISTS idx_waitpoints_timeout ON waitpoints(timeout_at) WHERE status = 'waiting';

-- Down Migration: Drop waitpoints table
DROP TABLE IF EXISTS waitpoints;
