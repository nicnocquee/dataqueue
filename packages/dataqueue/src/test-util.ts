import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { runner } from 'node-pg-migrate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

/**
 * Create a Redis test setup with a unique prefix to isolate tests.
 * Returns the prefix and a cleanup function.
 */
export function createRedisTestPrefix(): string {
  return `test_${randomUUID().replace(/-/g, '').slice(0, 12)}:`;
}

/**
 * Flush all keys with the given prefix from Redis.
 */
export async function cleanupRedisPrefix(
  redisClient: any,
  prefix: string,
): Promise<void> {
  // Use SCAN to find all keys with the prefix and delete them
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      `${prefix}*`,
      'COUNT',
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } while (cursor !== '0');
}
