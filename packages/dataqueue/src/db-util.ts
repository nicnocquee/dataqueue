import { Pool } from 'pg';
import { JobQueueConfig } from './types.js';
import { parse } from 'pg-connection-string';

// Create a database connection pool
export const createPool = (config: JobQueueConfig['databaseConfig']): Pool => {
  let searchPath: string | undefined;
  if (config.connectionString) {
    // Parse the connection string to extract search_path from query params
    try {
      const url = new URL(config.connectionString);
      searchPath = url.searchParams.get('search_path') || undefined;
    } catch (e) {
      // fallback: try pg-connection-string parse (for non-standard URLs)
      const parsed = parse(config.connectionString);
      if (parsed.options) {
        // options might look like '-c search_path=myschema'
        const match = parsed.options.match(/search_path=([^\s]+)/);
        if (match) {
          searchPath = match[1];
        }
      }
    }
  }

  const pool = new Pool(config);

  // If search_path is specified, set it for every new connection
  if (searchPath) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${searchPath}`);
    });
  }

  return pool;
};
