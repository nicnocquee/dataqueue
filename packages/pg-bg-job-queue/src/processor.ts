import { Pool } from 'pg';
import { JobRecord, JobHandler, ProcessorOptions, Processor } from './types.js';
import {
  getNextBatch,
  completeJob,
  failJob,
  setPendingReasonForUnpickedJobs,
} from './queue.js';
import { log, setLogContext } from './log-context.js';

/**
 * Map of job types to handlers
 */
let jobHandlers: Record<string, (payload: any) => Promise<void>> = {};

/**
 * Register a job handler
 */
export function registerJobHandler<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(jobType: T, handler: (payload: PayloadMap[T]) => Promise<void>): void {
  jobHandlers[jobType] = handler;
}

/**
 * Process a single job
 */
export async function processJob<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(pool: Pool, job: JobRecord<PayloadMap, T>): Promise<void> {
  const handler = jobHandlers[job.job_type];

  if (!handler) {
    await setPendingReasonForUnpickedJobs(
      pool,
      `No handler registered for job type: ${job.job_type}`,
      job.job_type,
    );
    await failJob(
      pool,
      job.id,
      new Error(`No handler registered for job type: ${job.job_type}`),
    );
    return;
  }

  try {
    await handler(job.payload);
    await completeJob(pool, job.id);
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    await failJob(
      pool,
      job.id,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Process a batch of jobs
 * @param pool - The database pool
 * @param workerId - The worker ID
 * @param batchSize - The batch size
 * @param jobType - Only process jobs with this job type (or array of types)
 */
export const processBatch = async (
  pool: Pool,
  workerId: string,
  batchSize = 10,
  jobType?: string | string[],
): Promise<number> => {
  const jobs = await getNextBatch(pool, workerId, batchSize, jobType);

  await Promise.all(jobs.map((job) => processJob(pool, job)));

  return jobs.length;
};

/**
 * Start a job processor that continuously processes jobs
 * @param pool - The database pool
 * @param options - The processor options. Leave pollInterval empty to run only once. Use jobType to filter jobs by type.
 * @returns {Processor} The processor instance
 */
export const createProcessor = (
  pool: Pool,
  options: ProcessorOptions = {},
): Processor => {
  const {
    workerId = `worker-${Math.random().toString(36).substring(2, 9)}`,
    batchSize = 10,
    pollInterval = 5000,
    onError = (error: Error) => console.error('Job processor error:', error),
    jobType,
  } = options;

  let running = false;
  let intervalId: NodeJS.Timeout | null = null;

  setLogContext(options.verbose ?? false);

  const processJobs = async (): Promise<number> => {
    if (!running) return 0;

    log(
      `Processing jobs with workerId: ${workerId}${jobType ? ` and jobType: ${Array.isArray(jobType) ? jobType.join(',') : jobType}` : ''}`,
    );

    try {
      const processed = await processBatch(pool, workerId, batchSize, jobType);

      // If we processed a full batch, there might be more jobs ready
      if (processed === batchSize) {
        // Process next batch immediately
        setImmediate(processJobs);
      }
      return processed;
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    return 0;
  };

  return {
    /**
     * Start the job processor in the background.
     * - This will run periodically (every pollInterval milliseconds or 5 seconds if not provided) and process jobs as they become available.
     * - You have to call the stop method to stop the processor.
     */
    startInBackground: () => {
      if (running) return;

      log(`Starting job processor with workerId: ${workerId}`);
      running = true;
      processJobs(); // Process immediately on start
      intervalId = setInterval(processJobs, pollInterval);
    },
    /**
     * Stop the job processor that runs in the background
     */
    stop: () => {
      log(`Stopping job processor with workerId: ${workerId}`);
      running = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    /**
     * Start the job processor synchronously.
     * - This will process all jobs immediately and then stop.
     * - The pollInterval is ignored.
     */
    start: async () => {
      log(`Starting job processor with workerId: ${workerId}`);
      running = true;
      const processed = await processJobs();
      running = false;
      return processed;
    },
    isRunning: () => running,
  };
};
