-- Up Migration: Add timeout_ms and failure_reason to job_queue
ALTER TABLE job_queue ADD COLUMN timeout_ms INT;
ALTER TABLE job_queue ADD COLUMN failure_reason VARCHAR;

-- Down Migration: Remove timeout_ms and failure_reason from job_queue
ALTER TABLE job_queue DROP COLUMN IF EXISTS timeout_ms;
ALTER TABLE job_queue DROP COLUMN IF EXISTS failure_reason; 