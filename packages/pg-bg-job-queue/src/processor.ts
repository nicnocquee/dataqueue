import { Pool } from 'pg';
import {
  JobRecord,
  ProcessorOptions,
  Processor,
  JobHandler,
  JobType,
  FailureReason,
  JobHandlers,
} from './types.js';
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
export async function processJobWithHandlers<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  job: JobRecord<PayloadMap, T>,
  jobHandlers: JobHandlers<PayloadMap>,
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
      FailureReason.NoHandler,
    );
    return;
  }

  // Per-job timeout logic
  const timeoutMs = job.timeout_ms ?? undefined;
  let timeoutId: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    const jobPromise = handler(job.payload, controller.signal);
    if (timeoutMs && timeoutMs > 0) {
      await Promise.race([
        jobPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            const timeoutError = new Error(
              `Job timed out after ${timeoutMs} ms`,
            );
            // @ts-ignore
            timeoutError.failureReason = FailureReason.Timeout;
            reject(timeoutError);
          }, timeoutMs);
        }),
      ]);
    } else {
      await jobPromise;
    }
    if (timeoutId) clearTimeout(timeoutId);
    await completeJob(pool, job.id);
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error(`Error processing job ${job.id}:`, error);
    let failureReason = FailureReason.HandlerError;
    if (
      error &&
      typeof error === 'object' &&
      'failureReason' in error &&
      (error as any).failureReason === FailureReason.Timeout
    ) {
      failureReason = FailureReason.Timeout;
    }
    await failJob(
      pool,
      job.id,
      error instanceof Error ? error : new Error(String(error)),
      failureReason,
    );
  }
}

/**
 * Process a batch of jobs using the provided handler map and concurrency limit
 */
export async function processBatchWithHandlers<PayloadMap>(
  pool: Pool,
  workerId: string,
  batchSize: number,
  jobType: string | string[] | undefined,
  jobHandlers: JobHandlers<PayloadMap>,
  concurrency?: number,
): Promise<number> {
  const jobs = await getNextBatch<PayloadMap, JobType<PayloadMap>>(
    pool,
    workerId,
    batchSize,
    jobType,
  );
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
  handlers: JobHandlers<PayloadMap>,
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
        handlers,
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
