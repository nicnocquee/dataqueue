import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { runner } from 'node-pg-migrate';

export async function createTestDbAndPool() {
  const baseDatabaseUrl =
    process.env.PG_TEST_URL ||
    'postgres://postgres:postgres@localhost:5432/postgres';
  const dbName = `test_db_${randomUUID().replace(/-/g, '')}`;

  // 1. Connect to the default database to create a new test database
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  await adminPool.end();

  // 2. Connect to the new test database
  const testDbUrl = baseDatabaseUrl.replace(/(\/)[^/]+$/, `/${dbName}`);
  const pool = new Pool({ connectionString: testDbUrl });

  // Wait a bit to ensure DB visibility
  await new Promise((r) => setTimeout(r, 50));

  // 3. Run migrations
  try {
    await runner({
      databaseUrl: testDbUrl,
      dir: join(__dirname, '../migrations'),
      direction: 'up',
      count: Infinity,
      migrationsTable: 'pgmigrations',
      verbose: false,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
  } catch (error) {
    console.error(error);
  }

  return { pool, dbName, testDbUrl };
}

export async function destroyTestDb(dbName: string) {
  const baseDatabaseUrl =
    process.env.PG_TEST_URL ||
    'postgres://postgres:postgres@localhost:5432/postgres';
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });
  // Terminate all connections to the test database before dropping
  await adminPool.query(
    `
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `,
    [dbName],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await adminPool.end();
}
