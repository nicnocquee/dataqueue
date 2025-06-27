import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { initializeJobQueue } from './setup.js';

export async function createTestSchemaAndPool() {
  const basePool = new Pool({
    connectionString:
      process.env.PG_TEST_URL ||
      'postgres://postgres:postgres@localhost:5432/postgres',
  });
  const schema = `test_schema_${randomUUID().replace(/-/g, '')}`;
  await basePool.query(`CREATE SCHEMA ${schema}`);

  const pool = new Pool({
    connectionString:
      process.env.PG_TEST_URL ||
      'postgres://postgres:postgres@localhost:5432/postgres',
    options: `-c search_path=${schema}`,
  });

  // Wait a bit to ensure schema/table visibility
  await new Promise((r) => setTimeout(r, 50));

  // Explicitly set search_path for the session
  await pool.query(`SET search_path TO ${schema}`);

  await initializeJobQueue(pool);

  return { pool, schema, basePool };
}

export async function destroyTestSchema(basePool: Pool, schema: string) {
  await basePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await basePool.end();
}
