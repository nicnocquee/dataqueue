-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS tags TEXT[];
CREATE INDEX IF NOT EXISTS idx_job_queue_tags ON job_queue USING GIN (tags);

-- Down Migration
DROP INDEX IF EXISTS idx_job_queue_tags;
ALTER TABLE job_queue DROP COLUMN IF EXISTS tags; 