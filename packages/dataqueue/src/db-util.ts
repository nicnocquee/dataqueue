import { Pool } from 'pg';
import { PostgresJobQueueConfig } from './types.js';
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
export const createPool = (
  config: PostgresJobQueueConfig['databaseConfig'],
): Pool => {
  let searchPath: string | undefined;
  let ssl: any = undefined;
  let customCA: string | undefined;
  let sslmode: string | undefined;

  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      searchPath = url.searchParams.get('search_path') || undefined;
      sslmode = url.searchParams.get('sslmode') || undefined;
      if (sslmode === 'no-verify') {
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
      sslmode = typeof parsed.sslmode === 'string' ? parsed.sslmode : undefined;
      if (sslmode === 'no-verify') {
        ssl = { rejectUnauthorized: false };
      }
    }
  }

  // Flexible SSL loading: only support file:// for file loading
  if (config.ssl) {
    if (typeof config.ssl.ca === 'string') {
      customCA = config.ssl.ca;
    } else if (typeof process.env.PGSSLROOTCERT === 'string') {
      customCA = process.env.PGSSLROOTCERT;
    } else {
      customCA = undefined;
    }
    const caValue =
      typeof customCA === 'string' ? loadPemOrFile(customCA) : undefined;
    ssl = {
      ...ssl,
      ...(caValue ? { ca: caValue } : {}),
      cert: loadPemOrFile(
        typeof config.ssl.cert === 'string'
          ? config.ssl.cert
          : process.env.PGSSLCERT,
      ),
      key: loadPemOrFile(
        typeof config.ssl.key === 'string'
          ? config.ssl.key
          : process.env.PGSSLKEY,
      ),
      rejectUnauthorized:
        config.ssl.rejectUnauthorized !== undefined
          ? config.ssl.rejectUnauthorized
          : true,
    };
  }

  // Warn if both sslmode (any value) and a custom CA are set
  if (sslmode && customCA) {
    const warning = `\n\n\x1b[33m**************************************************\n\u26A0\uFE0F  WARNING: SSL CONFIGURATION ISSUE\n**************************************************\nBoth sslmode ('${sslmode}') is set in the connection string\nand a custom CA is provided (via config.ssl.ca or PGSSLROOTCERT).\nThis combination may cause connection failures or unexpected behavior.\n\nRecommended: Remove sslmode from the connection string when using a custom CA.\n**************************************************\x1b[0m\n`;
    console.warn(warning);
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
