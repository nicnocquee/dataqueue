import { Pool, PoolClient } from 'pg';

export interface JobOptions {
  job_type: string;
  payload: Record<string, any>;
  max_attempts?: number;
  priority?: number;
  run_at?: Date | null;
}

export interface JobRecord {
  id: number;
  job_type: string;
  payload: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  priority: number;
  run_at: Date;
}

export interface JobHandler {
  handler: (payload: Record<string, any>) => Promise<void>;
}

export interface ProcessorOptions {
  workerId?: string;
  batchSize?: number;
  pollInterval?: number;
  onError?: (error: Error) => void;
}

export interface Processor {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
}

export interface JobQueueConfig {
  databaseConfig: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: any;
  };
}

export interface JobQueue {
  addJob: (job: JobOptions) => Promise<number>;
  getJob: (id: number) => Promise<JobRecord | null>;
  getJobsByStatus: (
    status: string,
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord[]>;
  retryJob: (jobId: number) => Promise<void>;
  cleanupOldJobs: (daysToKeep?: number) => Promise<number>;
  registerJobHandler: (
    jobType: string,
    handler: (payload: Record<string, any>) => Promise<void>,
  ) => void;
  createProcessor: (options?: ProcessorOptions) => Processor;
  getPool: () => Pool;
}
