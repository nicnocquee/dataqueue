import { Pool } from 'pg';
import { JobRecord, JobHandler, ProcessorOptions, Processor } from './types.js';
import { getNextBatch, completeJob, failJob } from './queue.js';
import { log, setLogContext } from './log-context.js';

/**
 * Map of job types to handlers
 */
const jobHandlers: Record<string, JobHandler<any>> = {};

/**
 * Register a job handler
 */
export const registerJobHandler = (
  jobType: string,
  handler: (payload: Record<string, any>) => Promise<void>,
): void => {
  jobHandlers[jobType] = { handler };
};

/**
 * Process a single job
 */
export const processJob = async <T>(
  pool: Pool,
  job: JobRecord<T>,
): Promise<void> => {
  const handler = jobHandlers[job.job_type];

  if (!handler) {
    await failJob(
      pool,
      job.id,
      new Error(`No handler registered for job type: ${job.job_type}`),
    );
    return;
  }

  try {
    await handler.handler(job.payload);
    await completeJob(pool, job.id);
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    await failJob(
      pool,
      job.id,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
};

/**
 * Process a batch of jobs
 */
export const processBatch = async (
  pool: Pool,
  workerId: string,
  batchSize = 10,
): Promise<number> => {
  const jobs = await getNextBatch(pool, workerId, batchSize);

  await Promise.all(jobs.map((job) => processJob(pool, job)));

  return jobs.length;
};

/**
 * Start a job processor that continuously processes jobs
 * @param pool - The database pool
 * @param options - The processor options. Leave pollInterval empty to run only once.
 * @returns The processor instance
 */
export const createProcessor = (
  pool: Pool,
  options: ProcessorOptions = {},
): Processor => {
  const {
    workerId = `worker-${Math.random().toString(36).substring(2, 9)}`,
    batchSize = 10,
    pollInterval,
    onError = (error: Error) => console.error('Job processor error:', error),
  } = options;

  let running = false;
  let intervalId: NodeJS.Timeout | null = null;

  setLogContext(options.verbose ?? false);

  const processJobs = async (): Promise<void> => {
    if (!running) return;

    log(`Processing jobs with workerId: ${workerId}`);

    try {
      const processed = await processBatch(pool, workerId, batchSize);

      // If we processed a full batch, there might be more jobs ready
      if (processed === batchSize) {
        // Process next batch immediately
        setImmediate(processJobs);
      }

      if (processed === 0) {
        running = false;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return {
    start: () => {
      if (running) return;

      log(`Starting job processor with workerId: ${workerId}`);
      running = true;
      processJobs(); // Process immediately on start
      if (pollInterval) {
        intervalId = setInterval(processJobs, pollInterval);
      }
    },
    stop: () => {
      log(`Stopping job processor with workerId: ${workerId}`);
      running = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    isRunning: () => running,
  };
};
