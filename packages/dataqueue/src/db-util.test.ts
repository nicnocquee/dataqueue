import { describe, it, expect, afterAll, vi } from 'vitest';
import { createPool } from './db-util.js';
import fs from 'fs';

// Use a test schema name that is unlikely to exist
const TEST_SCHEMA = 'testschema';
const TEST_CONN = `postgres://postgres:postgres@localhost:5432/postgres?search_path=${TEST_SCHEMA}`;

// Dummy PEM string for testing
const DUMMY_PEM =
  '-----BEGIN CERTIFICATE-----\nDUMMY\n-----END CERTIFICATE-----';

// Helper to mock fs.readFileSync
function mockReadFileSync(content: string) {
  return vi.spyOn(fs, 'readFileSync').mockImplementation(() => content);
}

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

  it('should use PEM string directly for ssl.ca', () => {
    const pool = createPool({
      connectionString: TEST_CONN,
      ssl: { ca: DUMMY_PEM, rejectUnauthorized: true },
    });
    const ssl = pool.options.ssl;
    if (typeof ssl === 'object' && ssl !== null) {
      expect(ssl.ca).toBe(DUMMY_PEM);
    } else {
      throw new Error('ssl is not an object');
    }
    pool.end();
  });

  it('should load ca from file when using file:// path', () => {
    const spy = mockReadFileSync(DUMMY_PEM);
    const pool = createPool({
      connectionString: TEST_CONN,
      ssl: { ca: 'file:///dummy/path/ca.crt', rejectUnauthorized: true },
    });
    const ssl = pool.options.ssl;
    if (typeof ssl === 'object' && ssl !== null) {
      expect(spy).toHaveBeenCalledWith('/dummy/path/ca.crt', 'utf8');
      expect(ssl.ca).toBe(DUMMY_PEM);
    } else {
      throw new Error('ssl is not an object');
    }
    pool.end();
    spy.mockRestore();
  });

  it('should set rejectUnauthorized to false for self-signed certs', () => {
    const pool = createPool({
      connectionString: TEST_CONN,
      ssl: { ca: DUMMY_PEM, rejectUnauthorized: false },
    });
    const ssl = pool.options.ssl;
    if (typeof ssl === 'object' && ssl !== null) {
      expect(ssl.rejectUnauthorized).toBe(false);
    } else {
      throw new Error('ssl is not an object');
    }
    pool.end();
  });
});
