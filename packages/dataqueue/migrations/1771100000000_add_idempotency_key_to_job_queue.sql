-- Up Migration: Add idempotency_key to job_queue
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_idempotency_key ON job_queue (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Down Migration: Remove idempotency_key from job_queue
DROP INDEX IF EXISTS idx_job_queue_idempotency_key;
ALTER TABLE job_queue DROP COLUMN IF EXISTS idempotency_key;
