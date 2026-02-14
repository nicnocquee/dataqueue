-- Up Migration: Add wait support columns to job_queue
ALTER TABLE job_queue ADD COLUMN wait_until TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE job_queue ADD COLUMN wait_token_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE job_queue ADD COLUMN step_data JSONB DEFAULT '{}';

CREATE INDEX idx_job_queue_wait_until ON job_queue (wait_until) WHERE status = 'waiting' AND wait_until IS NOT NULL;

-- Down Migration: Remove wait support columns from job_queue
DROP INDEX IF EXISTS idx_job_queue_wait_until;
ALTER TABLE job_queue DROP COLUMN IF EXISTS wait_until;
ALTER TABLE job_queue DROP COLUMN IF EXISTS wait_token_id;
ALTER TABLE job_queue DROP COLUMN IF EXISTS step_data;
