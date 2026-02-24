-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS dead_letter_job_type VARCHAR(255);
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS dead_letter_job_id INT;

ALTER TABLE cron_schedules ADD COLUMN IF NOT EXISTS dead_letter_job_type VARCHAR(255);

-- Down Migration
ALTER TABLE job_queue DROP COLUMN IF EXISTS dead_letter_job_type;
ALTER TABLE job_queue DROP COLUMN IF EXISTS dead_lettered_at;
ALTER TABLE job_queue DROP COLUMN IF EXISTS dead_letter_job_id;

ALTER TABLE cron_schedules DROP COLUMN IF EXISTS dead_letter_job_type;
