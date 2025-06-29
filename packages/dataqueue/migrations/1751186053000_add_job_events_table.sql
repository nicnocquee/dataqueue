-- Up Migration
CREATE TABLE IF NOT EXISTS job_events (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

ALTER TABLE job_events ADD CONSTRAINT fk_job_events_job_queue FOREIGN KEY (job_id) REFERENCES job_queue(id) ON DELETE CASCADE;
CREATE INDEX idx_job_events_job_id ON job_events(job_id);
CREATE INDEX idx_job_events_event_type ON job_events(event_type);

ALTER TABLE job_queue ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN started_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN last_retried_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN last_failed_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN last_cancelled_at TIMESTAMPTZ;

-- Down Migration
DROP INDEX IF EXISTS idx_job_events_event_type;
DROP INDEX IF EXISTS idx_job_events_job_id;
DROP TABLE IF EXISTS job_events; 

ALTER TABLE job_queue DROP COLUMN IF EXISTS completed_at;
ALTER TABLE job_queue DROP COLUMN IF EXISTS started_at;
ALTER TABLE job_queue DROP COLUMN IF EXISTS last_retried_at;
ALTER TABLE job_queue DROP COLUMN IF EXISTS last_failed_at;
ALTER TABLE job_queue DROP COLUMN IF EXISTS last_cancelled_at;