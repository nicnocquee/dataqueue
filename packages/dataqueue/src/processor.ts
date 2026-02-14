import { Pool } from 'pg';
import { Worker } from 'worker_threads';
import {
  JobRecord,
  ProcessorOptions,
  Processor,
  JobHandler,
  JobType,
  FailureReason,
  JobHandlers,
  JobContext,
  OnTimeoutCallback,
} from './types.js';
import {
  getNextBatch,
  completeJob,
  failJob,
  prolongJob,
  setPendingReasonForUnpickedJobs,
} from './queue.js';
import { log, setLogContext } from './log-context.js';

/**
 * Validates that a handler can be serialized for worker thread execution.
 * Throws an error with helpful message if serialization fails.
 */
function validateHandlerSerializable<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(handler: JobHandler<PayloadMap, T>, jobType: string): void {
  try {
    const handlerString = handler.toString();

    // Check for common patterns that indicate non-serializable handlers
    // 1. Arrow functions that capture 'this' (indicated by 'this' in the function body but not in parameters)
    if (
      handlerString.includes('this.') &&
      !handlerString.match(/\([^)]*this[^)]*\)/)
    ) {
      throw new Error(
        `Handler for job type "${jobType}" uses 'this' context which cannot be serialized. ` +
          `Use a regular function or avoid 'this' references when forceKillOnTimeout is enabled.`,
      );
    }

    // 2. Check if handler string looks like it might have closures
    // This is a heuristic - we can't perfectly detect closures, but we can warn about common patterns
    if (handlerString.includes('[native code]')) {
      throw new Error(
        `Handler for job type "${jobType}" contains native code which cannot be serialized. ` +
          `Ensure your handler is a plain function when forceKillOnTimeout is enabled.`,
      );
    }

    // 3. Try to create a function from the string to validate it's parseable
    // This will catch syntax errors early
    try {
      new Function('return ' + handlerString);
    } catch (parseError) {
      throw new Error(
        `Handler for job type "${jobType}" cannot be serialized: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
          `When using forceKillOnTimeout, handlers must be serializable functions without closures over external variables.`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      `Failed to validate handler serialization for job type "${jobType}": ${String(error)}`,
    );
  }
}

/**
 * Run a handler in a worker thread for force-kill capability.
 *
 * **IMPORTANT**: The handler must be serializable for this to work. This means:
 * - The handler should be a standalone function or arrow function
 * - It should not capture variables from outer scopes (closures) that reference external dependencies
 * - It should not use 'this' context unless it's a bound method
 * - All dependencies must be importable in the worker thread context
 *
 * If your handler doesn't meet these requirements, use the default graceful shutdown
 * (forceKillOnTimeout: false) and ensure your handler checks signal.aborted.
 *
 * @throws {Error} If the handler cannot be serialized
 */
async function runHandlerInWorker<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  handler: JobHandler<PayloadMap, T>,
  payload: PayloadMap[T],
  timeoutMs: number,
  jobType: string,
): Promise<void> {
  // Validate handler can be serialized before attempting to run in worker
  validateHandlerSerializable(handler, jobType);

  return new Promise((resolve, reject) => {
    // Use inline worker code for better compatibility
    // Note: This requires the handler to be serializable (no closures with external dependencies)
    // Wrap in IIFE to allow return statements
    const workerCode = `
      (function() {
        const { parentPort, workerData } = require('worker_threads');
        const { handlerCode, payload, timeoutMs } = workerData;
        
        // Create an AbortController for the handler
        const controller = new AbortController();
        const signal = controller.signal;
        
        // Set up timeout
        const timeoutId = setTimeout(() => {
          controller.abort();
          parentPort.postMessage({ type: 'timeout' });
        }, timeoutMs);
        
        try {
          // Execute the handler
          // Note: This uses Function constructor which requires the handler to be serializable.
          // The handler should be validated before reaching this point.
          let handlerFn;
          try {
            // Wrap handlerCode in parentheses to ensure it's treated as an expression
            // This handles both arrow functions and regular functions
            const wrappedCode = handlerCode.trim().startsWith('async') || handlerCode.trim().startsWith('function')
              ? handlerCode
              : '(' + handlerCode + ')';
            handlerFn = new Function('return ' + wrappedCode)();
          } catch (parseError) {
            clearTimeout(timeoutId);
            parentPort.postMessage({
              type: 'error',
              error: {
                message: 'Handler cannot be deserialized in worker thread. ' +
                  'Ensure your handler is a standalone function without closures over external variables. ' +
                  'Original error: ' + (parseError instanceof Error ? parseError.message : String(parseError)),
                stack: parseError instanceof Error ? parseError.stack : undefined,
                name: 'SerializationError',
              },
            });
            return;
          }
          
          // Ensure handlerFn is actually a function
          if (typeof handlerFn !== 'function') {
            clearTimeout(timeoutId);
            parentPort.postMessage({
              type: 'error',
              error: {
                message: 'Handler deserialization did not produce a function. ' +
                  'Ensure your handler is a valid function when forceKillOnTimeout is enabled.',
                name: 'SerializationError',
              },
            });
            return;
          }
          
          handlerFn(payload, signal)
            .then(() => {
              clearTimeout(timeoutId);
              parentPort.postMessage({ type: 'success' });
            })
            .catch((error) => {
              clearTimeout(timeoutId);
              parentPort.postMessage({
                type: 'error',
                error: {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                },
              });
            });
        } catch (error) {
          clearTimeout(timeoutId);
          parentPort.postMessage({
            type: 'error',
            error: {
              message: error.message,
              stack: error.stack,
              name: error.name,
            },
          });
        }
      })();
    `;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        handlerCode: handler.toString(),
        payload,
        timeoutMs,
      },
    });

    let resolved = false;

    worker.on('message', (message: { type: string; error?: any }) => {
      if (resolved) return;
      resolved = true;

      if (message.type === 'success') {
        resolve();
      } else if (message.type === 'timeout') {
        const timeoutError = new Error(
          `Job timed out after ${timeoutMs} ms and was forcefully terminated`,
        );
        // @ts-ignore
        timeoutError.failureReason = FailureReason.Timeout;
        reject(timeoutError);
      } else if (message.type === 'error') {
        const error = new Error(message.error.message);
        error.stack = message.error.stack;
        error.name = message.error.name;
        reject(error);
      }
    });

    worker.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      reject(error);
    });

    worker.on('exit', (code) => {
      if (resolved) return;
      if (code !== 0) {
        resolved = true;
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    // Force terminate worker on timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        worker
          .terminate()
          .then(() => {
            const timeoutError = new Error(
              `Job timed out after ${timeoutMs} ms and was forcefully terminated`,
            );
            // @ts-ignore
            timeoutError.failureReason = FailureReason.Timeout;
            reject(timeoutError);
          })
          .catch((err) => {
            reject(err);
          });
      }
    }, timeoutMs + 100); // Small buffer to ensure timeout is handled
  });
}

/**
 * Create a no-op JobContext for cases where prolong/onTimeout are not supported
 * (e.g. forceKillOnTimeout mode or no timeout set).
 */
function createNoOpContext(reason: string): JobContext {
  return {
    prolong: () => {
      log(`prolong() called but ignored: ${reason}`);
    },
    onTimeout: () => {
      log(`onTimeout() called but ignored: ${reason}`);
    },
  };
}

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
  const handler = jobHandlers[job.jobType];

  if (!handler) {
    await setPendingReasonForUnpickedJobs(
      pool,
      `No handler registered for job type: ${job.jobType}`,
      job.jobType,
    );
    await failJob(
      pool,
      job.id,
      new Error(`No handler registered for job type: ${job.jobType}`),
      FailureReason.NoHandler,
    );
    return;
  }

  // Per-job timeout logic
  const timeoutMs = job.timeoutMs ?? undefined;
  const forceKillOnTimeout = job.forceKillOnTimeout ?? false;
  let timeoutId: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    // If forceKillOnTimeout is true, run handler in a worker thread
    if (forceKillOnTimeout && timeoutMs && timeoutMs > 0) {
      await runHandlerInWorker(handler, job.payload, timeoutMs, job.jobType);
    } else {
      // Build the JobContext for prolong/onTimeout support
      let onTimeoutCallback: OnTimeoutCallback | undefined;

      // Reference to the reject function of the timeout promise so we can re-arm it
      let timeoutReject: ((error: Error) => void) | undefined;

      /**
       * Arms (or re-arms) the timeout. When it fires:
       * 1. If an onTimeout callback is registered, call it first.
       *    - If it returns a positive number, re-arm with that duration and update DB.
       *    - Otherwise, proceed with abort.
       * 2. If no onTimeout callback, proceed with abort.
       */
      const armTimeout = (ms: number) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          // Check if an onTimeout callback wants to extend
          if (onTimeoutCallback) {
            const extension = onTimeoutCallback();
            if (typeof extension === 'number' && extension > 0) {
              // Extend: re-arm timeout and update DB
              prolongJob(pool, job.id).catch(() => {});
              armTimeout(extension);
              return;
            }
          }
          // No extension -- proceed with abort
          controller.abort();
          const timeoutError = new Error(`Job timed out after ${ms} ms`);
          // @ts-ignore
          timeoutError.failureReason = FailureReason.Timeout;
          if (timeoutReject) {
            timeoutReject(timeoutError);
          }
        }, ms);
      };

      const hasTimeout = timeoutMs != null && timeoutMs > 0;

      const ctx: JobContext = hasTimeout
        ? {
            prolong: (ms?: number) => {
              const duration = ms ?? timeoutMs;
              if (duration != null && duration > 0) {
                armTimeout(duration);
                // Update DB locked_at to prevent reclaimStuckJobs
                prolongJob(pool, job.id).catch(() => {});
              }
            },
            onTimeout: (callback: OnTimeoutCallback) => {
              onTimeoutCallback = callback;
            },
          }
        : createNoOpContext('job has no timeout set');

      // If forceKillOnTimeout was set but timeoutMs was missing, warn
      if (forceKillOnTimeout && !hasTimeout) {
        log(
          `forceKillOnTimeout is set but no timeoutMs for job ${job.id}, running without force kill`,
        );
      }

      const jobPromise = handler(job.payload, controller.signal, ctx);

      if (hasTimeout) {
        await Promise.race([
          jobPromise,
          new Promise<never>((_, reject) => {
            timeoutReject = reject;
            armTimeout(timeoutMs!);
          }),
        ]);
      } else {
        await jobPromise;
      }
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
