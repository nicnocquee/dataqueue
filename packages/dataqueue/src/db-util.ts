import { Pool } from 'pg';
import { JobQueueConfig } from './types.js';
import { parse } from 'pg-connection-string';
import fs from 'fs';

/**
 * Helper to load a PEM string or file. Only values starting with 'file://' are loaded from file.
 */
function loadPemOrFile(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('file://')) {
    const filePath = value.slice(7);
    return fs.readFileSync(filePath, 'utf8');
  }
  return value;
}

/**
 * Create a database connection pool with flexible SSL certificate loading.
 *
 * SSL config example (for local file paths):
 *   ssl: {
 *     ca: 'file:///absolute/path/to/ca.crt',
 *     cert: 'file:///absolute/path/to/client.crt',
 *     key: 'file:///absolute/path/to/client.key',
 *     rejectUnauthorized: true
 *   }
 *
 * SSL config example (for Vercel or env PEM strings):
 *   ssl: {
 *     ca: process.env.PG_CA, // PEM string
 *     cert: process.env.PG_CERT, // PEM string
 *     key: process.env.PG_KEY, // PEM string
 *     rejectUnauthorized: true
 *   }
 */
export const createPool = (config: JobQueueConfig['databaseConfig']): Pool => {
  let searchPath: string | undefined;
  let ssl: any = undefined;

  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      searchPath = url.searchParams.get('search_path') || undefined;
      if (url.searchParams.get('sslmode') === 'no-verify') {
        ssl = { rejectUnauthorized: false };
      }
    } catch (e) {
      const parsed = parse(config.connectionString);
      if (parsed.options) {
        const match = parsed.options.match(/search_path=([^\s]+)/);
        if (match) {
          searchPath = match[1];
        }
      }
      if (parsed.sslmode === 'no-verify') {
        ssl = { rejectUnauthorized: false };
      }
    }
  }

  // Flexible SSL loading: only support file:// for file loading
  if (config.ssl) {
    ssl = {
      ...ssl,
      ca: loadPemOrFile(config.ssl.ca),
      cert: loadPemOrFile(config.ssl.cert),
      key: loadPemOrFile(config.ssl.key),
      rejectUnauthorized:
        config.ssl.rejectUnauthorized !== undefined
          ? config.ssl.rejectUnauthorized
          : true,
    };
  }

  const pool = new Pool({
    ...config,
    ...(ssl ? { ssl } : {}),
  });

  if (searchPath) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${searchPath}`);
    });
  }

  return pool;
};
