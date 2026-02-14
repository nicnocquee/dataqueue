-- Up Migration: Add force_kill_on_timeout to job_queue
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS force_kill_on_timeout BOOLEAN DEFAULT FALSE;

-- Down Migration: Remove force_kill_on_timeout from job_queue
ALTER TABLE job_queue DROP COLUMN IF EXISTS force_kill_on_timeout;

