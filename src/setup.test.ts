import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool, initializeJobQueue, runMigrations } from './setup.js';
import { createTestSchemaAndPool, destroyTestSchema } from './test-util.js';
import { Pool } from 'pg';

// Integration tests for setup.ts

describe('setup integration', () => {
  let pool: Pool;
  let schema: string;
  let basePool: Pool;

  beforeEach(async () => {
    const setup = await createTestSchemaAndPool();
    pool = setup.pool;
    schema = setup.schema;
    basePool = setup.basePool;
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestSchema(basePool, schema);
  });

  it('createPool should create a working pool', async () => {
    const testPool = createPool({
      connectionString:
        process.env.PG_TEST_URL ||
        'postgres://postgres:postgres@localhost:5432/postgres',
    });
    const result = await testPool.query('SELECT 1 as value');
    expect(result.rows[0].value).toBe(1);
    await testPool.end();
  });

  it('initializeJobQueue should create the job_queue table', async () => {
    const res = await pool.query(
      `SELECT to_regclass('job_queue') as table_exists`,
    );
    expect(res.rows[0].table_exists).toBe('job_queue');
    // Check columns
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'job_queue'`,
    );
    const colNames = columns.rows.map((r) => r.column_name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        'id',
        'job_type',
        'payload',
        'status',
        'created_at',
        'updated_at',
        'locked_at',
        'locked_by',
        'attempts',
        'max_attempts',
        'next_attempt_at',
        'priority',
        'run_at',
      ]),
    );
  });

  it('runMigrations should add missing columns', async () => {
    // Remove priority and run_at columns if they exist
    await pool.query(`ALTER TABLE job_queue DROP COLUMN IF EXISTS priority`);
    await pool.query(`ALTER TABLE job_queue DROP COLUMN IF EXISTS run_at`);
    // Run migrations
    await runMigrations(pool);
    // Check columns again
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'job_queue'`,
    );
    const colNames = columns.rows.map((r) => r.column_name);
    expect(colNames).toEqual(expect.arrayContaining(['priority', 'run_at']));
  });
});
