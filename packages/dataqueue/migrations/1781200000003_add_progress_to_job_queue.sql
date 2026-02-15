-- Add progress column to job_queue for tracking job completion percentage (0-100).

-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT NULL;

-- Down Migration
ALTER TABLE job_queue DROP COLUMN IF EXISTS progress;
