import { Pool } from 'pg';

export interface JobOptions<T> {
  job_type: string;
  payload: T;
  max_attempts?: number;
  priority?: number;
  run_at?: Date | null;
}

export interface JobRecord<T> {
  id: number;
  job_type: string;
  payload: T;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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

export interface JobHandler<T> {
  handler: (payload: T) => Promise<void>;
}

export interface ProcessorOptions {
  workerId?: string;
  batchSize?: number;
  pollInterval?: number;
  onError?: (error: Error) => void;
  verbose?: boolean;
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
  verbose?: boolean;
}

export interface JobQueue {
  addJob: <T>(job: JobOptions<T>) => Promise<number>;
  getJob: <T>(id: number) => Promise<JobRecord<T> | null>;
  getJobsByStatus: <T>(
    status: string,
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord<T>[]>;
  getAllJobs: <T>(limit?: number, offset?: number) => Promise<JobRecord<T>[]>;
  retryJob: (jobId: number) => Promise<void>;
  cleanupOldJobs: (daysToKeep?: number) => Promise<number>;
  cancelJob: (jobId: number) => Promise<void>;
  cancelAllUpcomingJobs: (filters?: {
    job_type?: string;
    priority?: number;
    run_at?: Date;
  }) => Promise<number>;
  registerJobHandler: (
    jobType: string,
    handler: (payload: Record<string, any>) => Promise<void>,
  ) => void;
  createProcessor: (options?: ProcessorOptions) => Processor;
  getPool: () => Pool;
}
