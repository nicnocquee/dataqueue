-- Up Migration: Add group metadata fields for group-based concurrency limits
ALTER TABLE job_queue
  ADD COLUMN IF NOT EXISTS group_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS group_tier VARCHAR(255);

-- Index for efficient active-group concurrency checks
CREATE INDEX IF NOT EXISTS idx_job_queue_processing_group_id
  ON job_queue (group_id)
  WHERE status = 'processing' AND group_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_job_queue_processing_group_id;

ALTER TABLE job_queue
  DROP COLUMN IF EXISTS group_tier,
  DROP COLUMN IF EXISTS group_id;
