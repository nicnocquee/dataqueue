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
 *     ca: process.env.PGSSLROOTCERT, // PEM string or 'file://...'
 *     cert: process.env.PGSSLCERT,   // optional, PEM string or 'file://...'
 *     key: process.env.PGSSLKEY,     // optional, PEM string or 'file://...'
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
      ca: loadPemOrFile(config.ssl.ca ?? process.env.PGSSLROOTCERT),
      cert: loadPemOrFile(config.ssl.cert ?? process.env.PGSSLCERT),
      key: loadPemOrFile(config.ssl.key ?? process.env.PGSSLKEY),
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
