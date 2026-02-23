-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS retry_delay INT;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS retry_backoff BOOLEAN;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS retry_delay_max INT;

ALTER TABLE cron_schedules ADD COLUMN IF NOT EXISTS retry_delay INT;
ALTER TABLE cron_schedules ADD COLUMN IF NOT EXISTS retry_backoff BOOLEAN;
ALTER TABLE cron_schedules ADD COLUMN IF NOT EXISTS retry_delay_max INT;

-- Down Migration
ALTER TABLE job_queue DROP COLUMN IF EXISTS retry_delay;
ALTER TABLE job_queue DROP COLUMN IF EXISTS retry_backoff;
ALTER TABLE job_queue DROP COLUMN IF EXISTS retry_delay_max;

ALTER TABLE cron_schedules DROP COLUMN IF EXISTS retry_delay;
ALTER TABLE cron_schedules DROP COLUMN IF EXISTS retry_backoff;
ALTER TABLE cron_schedules DROP COLUMN IF EXISTS retry_delay_max;
