import { Pool } from 'pg';
import { JobQueueConfig } from './types.js';

// Create a database connection pool
export const createPool = (config: JobQueueConfig['databaseConfig']): Pool => {
  return new Pool(config);
};
