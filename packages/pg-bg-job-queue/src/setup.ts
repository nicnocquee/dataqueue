import { Pool } from 'pg';
import { JobQueueConfig } from './types.js';
import { log, setLogContext } from './log-context.js';

// Create a database connection pool
export const createPool = (config: JobQueueConfig['databaseConfig']): Pool => {
  return new Pool(config);
};

/**
 * Initialize the job queue table in the database
 */
export const initializeJobQueue = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id SERIAL PRIMARY KEY,
        job_type VARCHAR(255) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        locked_at TIMESTAMPTZ,
        locked_by VARCHAR(255),
        attempts INT DEFAULT 0,
        max_attempts INT DEFAULT 3,
        next_attempt_at TIMESTAMPTZ,
        priority INT DEFAULT 0,
        run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
      CREATE INDEX IF NOT EXISTS idx_job_queue_next_attempt ON job_queue(next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_job_queue_run_at ON job_queue(run_at);
      CREATE INDEX IF NOT EXISTS idx_job_queue_priority ON job_queue(priority);
    `);
    log('Job queue table initialized');
  } catch (error) {
    log(`Error initializing job queue table: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Run database migrations for the job queue
 */
export const runMigrations = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    // Check current schema version
    const checkVersionResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'job_queue' AND column_name = 'priority'
      ) as has_priority_column;
    `);

    const hasPriorityColumn = checkVersionResult.rows[0].has_priority_column;

    if (!hasPriorityColumn) {
      // Add priority column if it doesn't exist
      await client.query(`
        ALTER TABLE job_queue ADD COLUMN priority INT DEFAULT 0;
        CREATE INDEX idx_job_queue_priority ON job_queue(priority);
      `);
      log('Migration: Added priority column');
    }

    // Check for run_at column
    const checkRunAtResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'job_queue' AND column_name = 'run_at'
      ) as has_run_at_column;
    `);

    const hasRunAtColumn = checkRunAtResult.rows[0].has_run_at_column;

    if (!hasRunAtColumn) {
      // Add run_at column if it doesn't exist
      await client.query(`
        ALTER TABLE job_queue ADD COLUMN run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
        CREATE INDEX idx_job_queue_run_at ON job_queue(run_at);
      `);
      log('Migration: Added run_at column');
    }

    // Add more migrations as needed
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  } finally {
    client.release();
  }
};
