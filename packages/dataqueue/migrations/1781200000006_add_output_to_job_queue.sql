-- Add output column to job_queue for storing handler results as JSONB.
-- Up Migration
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS output JSONB DEFAULT NULL;
