-- Up Migration: Add composite and partial indexes for performance at scale

-- Composite partial index for the getNextBatch claim query.
-- Covers pending jobs ordered by priority then age.
-- The run_at <= NOW() filter is applied at query time (NOW() is not IMMUTABLE).
CREATE INDEX IF NOT EXISTS idx_job_queue_claimable
  ON job_queue (priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Partial index for failed jobs eligible for retry (used in getNextBatch).
CREATE INDEX IF NOT EXISTS idx_job_queue_failed_retry
  ON job_queue (next_attempt_at ASC)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;

-- Index for reclaimStuckJobs: processing jobs ordered by lock age.
CREATE INDEX IF NOT EXISTS idx_job_queue_stuck
  ON job_queue (locked_at ASC)
  WHERE status = 'processing';

-- Index for cleanupOldJobs: completed jobs by update time.
CREATE INDEX IF NOT EXISTS idx_job_queue_cleanup
  ON job_queue (updated_at ASC)
  WHERE status = 'completed';

-- Index for job_events cleanup and time-based queries.
CREATE INDEX IF NOT EXISTS idx_job_events_created_at
  ON job_events (created_at ASC);

-- Down Migration
DROP INDEX IF EXISTS idx_job_queue_claimable;
DROP INDEX IF EXISTS idx_job_queue_failed_retry;
DROP INDEX IF EXISTS idx_job_queue_stuck;
DROP INDEX IF EXISTS idx_job_queue_cleanup;
DROP INDEX IF EXISTS idx_job_events_created_at;
