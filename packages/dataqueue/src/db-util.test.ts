import { describe, it, expect, afterAll } from 'vitest';
import { createPool } from './db-util.js';

// Use a test schema name that is unlikely to exist
const TEST_SCHEMA = 'testschema';
const TEST_CONN = `postgres://postgres:postgres@localhost:5432/postgres?search_path=${TEST_SCHEMA}`;

describe('createPool', () => {
  const pool = createPool({ connectionString: TEST_CONN });

  afterAll(async () => {
    await pool.end();
  });

  it('should set search_path from connection string on every connection', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SHOW search_path');
      // search_path can be quoted or unquoted depending on Postgres version
      expect(res.rows[0].search_path.replace(/"/g, '')).toContain(TEST_SCHEMA);
    } finally {
      client.release();
    }
  });
});
