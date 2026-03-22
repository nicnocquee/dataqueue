-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS depends_on_job_ids INTEGER[];
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS depends_on_tags TEXT[];

CREATE INDEX IF NOT EXISTS idx_job_queue_depends_on_job_ids ON job_queue USING GIN (depends_on_job_ids);

-- Down Migration
DROP INDEX IF EXISTS idx_job_queue_depends_on_job_ids;
ALTER TABLE job_queue DROP COLUMN IF EXISTS depends_on_tags;
ALTER TABLE job_queue DROP COLUMN IF EXISTS depends_on_job_ids;
