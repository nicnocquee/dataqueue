import { Pool } from 'pg';
import { JobRecord, ProcessorOptions, Processor } from './types.js';
import {
  getNextBatch,
  completeJob,
  failJob,
  setPendingReasonForUnpickedJobs,
} from './queue.js';
import { log, setLogContext } from './log-context.js';

/**
 * Process a single job using the provided handler map
 */
async function processJobWithHandlers<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  job: JobRecord<PayloadMap, T>,
  jobHandlers: Record<string, (payload: any) => Promise<void>>,
): Promise<void> {
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
 * Process a batch of jobs using the provided handler map and concurrency limit
 */
async function processBatchWithHandlers<PayloadMap>(
  pool: Pool,
  workerId: string,
  batchSize: number,
  jobType: string | string[] | undefined,
  jobHandlers: Record<string, (payload: any) => Promise<void>>,
  concurrency?: number,
): Promise<number> {
  const jobs = await getNextBatch(pool, workerId, batchSize, jobType);
  if (!concurrency || concurrency >= jobs.length) {
    // Default: all in parallel
    await Promise.all(
      jobs.map((job) => processJobWithHandlers(pool, job, jobHandlers)),
    );
    return jobs.length;
  }
  // Concurrency-limited pool
  let idx = 0;
  let running = 0;
  let finished = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (finished === jobs.length) return resolve(jobs.length);
      while (running < concurrency && idx < jobs.length) {
        const job = jobs[idx++];
        running++;
        processJobWithHandlers(pool, job, jobHandlers)
          .then(() => {
            running--;
            finished++;
            next();
          })
          .catch((err) => {
            running--;
            finished++;
            next();
          });
      }
    };
    next();
  });
}

/**
 * Start a job processor that continuously processes jobs
 * @param pool - The database pool
 * @param handlers - The job handlers for this processor instance
 * @param options - The processor options. Leave pollInterval empty to run only once. Use jobType to filter jobs by type.
 * @returns {Processor} The processor instance
 */
export const createProcessor = <PayloadMap = any>(
  pool: Pool,
  handlers: {
    [K in keyof PayloadMap]: (payload: PayloadMap[K]) => Promise<void>;
  },
  options: ProcessorOptions = {},
): Processor => {
  const {
    workerId = `worker-${Math.random().toString(36).substring(2, 9)}`,
    batchSize = 10,
    pollInterval = 5000,
    onError = (error: Error) => console.error('Job processor error:', error),
    jobType,
    concurrency = 3,
  } = options;

  let running = false;
  let intervalId: NodeJS.Timeout | null = null;

  setLogContext(options.verbose ?? false);

  const jobHandlers = handlers as Record<
    string,
    (payload: any) => Promise<void>
  >;

  const processJobs = async (): Promise<number> => {
    if (!running) return 0;

    log(
      `Processing jobs with workerId: ${workerId}${jobType ? ` and jobType: ${Array.isArray(jobType) ? jobType.join(',') : jobType}` : ''}`,
    );

    try {
      const processed = await processBatchWithHandlers(
        pool,
        workerId,
        batchSize,
        jobType,
        jobHandlers,
        concurrency,
      );
      // Only process one batch in start; do not schedule next batch here
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
      // Background: process batches repeatedly if needed
      const processBatches = async () => {
        if (!running) return;
        const processed = await processJobs();
        if (processed === batchSize && running) {
          setImmediate(processBatches);
        }
      };
      processBatches(); // Process immediately on start
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
