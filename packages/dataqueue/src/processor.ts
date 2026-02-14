import { Worker } from 'worker_threads';
import { Pool } from 'pg';
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
  WaitSignal,
  WaitDuration,
  WaitTokenResult,
} from './types.js';
import { QueueBackend } from './backend.js';
import { PostgresBackend } from './backends/postgres.js';
import {
  waitJob,
  updateStepData,
  createWaitpoint,
  getWaitpoint,
} from './queue.js';
import { log, setLogContext } from './log-context.js';

/**
 * Try to extract the underlying pg Pool from a QueueBackend.
 * Returns null for non-PostgreSQL backends.
 */
function tryExtractPool(backend: QueueBackend): Pool | null {
  if (backend instanceof PostgresBackend) {
    return backend.getPool();
  }
  return null;
}

/**
 * Build a JobContext without wait support (for non-PostgreSQL backends).
 * prolong/onTimeout work normally; wait-related methods throw helpful errors.
 */
function buildBasicContext(baseCtx: {
  prolong: JobContext['prolong'];
  onTimeout: JobContext['onTimeout'];
}): JobContext {
  const waitError = () =>
    new Error(
      'Wait features (waitFor, waitUntil, createToken, waitForToken, ctx.run) are currently only supported with the PostgreSQL backend.',
    );
  return {
    prolong: baseCtx.prolong,
    onTimeout: baseCtx.onTimeout,
    run: async <T>(_stepName: string, fn: () => Promise<T>): Promise<T> => {
      // Without PostgreSQL, just execute the function directly (no persistence)
      return fn();
    },
    waitFor: async () => {
      throw waitError();
    },
    waitUntil: async () => {
      throw waitError();
    },
    createToken: async () => {
      throw waitError();
    },
    waitForToken: async () => {
      throw waitError();
    },
  };
}

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
 * Convert a WaitDuration to a target Date.
 */
function calculateWaitUntil(duration: WaitDuration): Date {
  const now = Date.now();
  let ms = 0;
  if (duration.seconds) ms += duration.seconds * 1000;
  if (duration.minutes) ms += duration.minutes * 60 * 1000;
  if (duration.hours) ms += duration.hours * 60 * 60 * 1000;
  if (duration.days) ms += duration.days * 24 * 60 * 60 * 1000;
  if (duration.weeks) ms += duration.weeks * 7 * 24 * 60 * 60 * 1000;
  if (duration.months) ms += duration.months * 30 * 24 * 60 * 60 * 1000;
  if (duration.years) ms += duration.years * 365 * 24 * 60 * 60 * 1000;
  if (ms <= 0) {
    throw new Error(
      'waitFor duration must be positive. Provide at least one positive duration field.',
    );
  }
  return new Date(now + ms);
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
    run: async <T>(_stepName: string, fn: () => Promise<T>): Promise<T> => {
      // In no-op context (forceKillOnTimeout), just execute the function directly
      return fn();
    },
    waitFor: async () => {
      throw new Error(
        `waitFor() is not supported when forceKillOnTimeout is enabled. ${reason}`,
      );
    },
    waitUntil: async () => {
      throw new Error(
        `waitUntil() is not supported when forceKillOnTimeout is enabled. ${reason}`,
      );
    },
    createToken: async () => {
      throw new Error(
        `createToken() is not supported when forceKillOnTimeout is enabled. ${reason}`,
      );
    },
    waitForToken: async () => {
      throw new Error(
        `waitForToken() is not supported when forceKillOnTimeout is enabled. ${reason}`,
      );
    },
  };
}

/**
 * Pre-process stepData before handler re-invocation.
 * Marks pending waits as completed and fetches token outputs.
 */
async function resolveCompletedWaits(
  pool: Pool,
  stepData: Record<string, any>,
): Promise<void> {
  for (const key of Object.keys(stepData)) {
    if (!key.startsWith('__wait_')) continue;
    const entry = stepData[key];
    if (!entry || typeof entry !== 'object' || entry.completed) continue;

    if (entry.type === 'duration' || entry.type === 'date') {
      // Time-based wait has elapsed (we got picked up, so it must have)
      stepData[key] = { ...entry, completed: true };
    } else if (entry.type === 'token' && entry.tokenId) {
      // Token-based wait -- fetch the waitpoint result
      const wp = await getWaitpoint(pool, entry.tokenId);
      if (wp && wp.status === 'completed') {
        stepData[key] = {
          ...entry,
          completed: true,
          result: { ok: true, output: wp.output },
        };
      } else if (wp && wp.status === 'timed_out') {
        stepData[key] = {
          ...entry,
          completed: true,
          result: { ok: false, error: 'Token timed out' },
        };
      }
      // If still waiting (shouldn't happen), leave as pending
    }
  }
}

/**
 * Build the extended JobContext with step tracking and wait support.
 */
function buildWaitContext(
  pool: Pool,
  jobId: number,
  stepData: Record<string, any>,
  baseCtx: {
    prolong: JobContext['prolong'];
    onTimeout: JobContext['onTimeout'];
  },
): JobContext {
  // Wait counter always starts at 0 per invocation.
  // The handler replays from the top each time, so the counter position
  // must match the order of waitFor/waitUntil/waitForToken calls in code.
  let waitCounter = 0;

  const ctx: JobContext = {
    prolong: baseCtx.prolong,
    onTimeout: baseCtx.onTimeout,

    run: async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
      // Check if step was already completed in a previous invocation
      const cached = stepData[stepName];
      if (cached && typeof cached === 'object' && cached.__completed) {
        log(`Step "${stepName}" replayed from cache for job ${jobId}`);
        return cached.result as T;
      }

      // Execute the step
      const result = await fn();

      // Persist step result
      stepData[stepName] = { __completed: true, result };
      await updateStepData(pool, jobId, stepData);

      return result;
    },

    waitFor: async (duration: WaitDuration): Promise<void> => {
      const waitKey = `__wait_${waitCounter++}`;

      // Check if this wait was already completed (from a previous invocation)
      const cached = stepData[waitKey];
      if (cached && typeof cached === 'object' && cached.completed) {
        log(`Wait "${waitKey}" already completed for job ${jobId}, skipping`);
        return;
      }

      // Calculate when to resume
      const waitUntilDate = calculateWaitUntil(duration);

      // Record this wait as pending in step data
      stepData[waitKey] = { type: 'duration', completed: false };

      // Throw WaitSignal to pause the handler
      throw new WaitSignal('duration', waitUntilDate, undefined, stepData);
    },

    waitUntil: async (date: Date): Promise<void> => {
      const waitKey = `__wait_${waitCounter++}`;

      // Check if this wait was already completed
      const cached = stepData[waitKey];
      if (cached && typeof cached === 'object' && cached.completed) {
        log(`Wait "${waitKey}" already completed for job ${jobId}, skipping`);
        return;
      }

      // Record this wait as pending
      stepData[waitKey] = { type: 'date', completed: false };

      // Throw WaitSignal to pause the handler
      throw new WaitSignal('date', date, undefined, stepData);
    },

    createToken: async (options?) => {
      const token = await createWaitpoint(pool, jobId, options);
      return token;
    },

    waitForToken: async <T = any>(
      tokenId: string,
    ): Promise<WaitTokenResult<T>> => {
      const waitKey = `__wait_${waitCounter++}`;

      // Check if this wait was already completed
      const cached = stepData[waitKey];
      if (cached && typeof cached === 'object' && cached.completed) {
        log(
          `Token wait "${waitKey}" already completed for job ${jobId}, returning cached result`,
        );
        return cached.result as WaitTokenResult<T>;
      }

      // Check if the token is already completed (e.g., completed while job was still processing)
      const wp = await getWaitpoint(pool, tokenId);
      if (wp && wp.status === 'completed') {
        const result: WaitTokenResult<T> = {
          ok: true,
          output: wp.output as T,
        };
        stepData[waitKey] = {
          type: 'token',
          tokenId,
          completed: true,
          result,
        };
        await updateStepData(pool, jobId, stepData);
        return result;
      }
      if (wp && wp.status === 'timed_out') {
        const result: WaitTokenResult<T> = {
          ok: false,
          error: 'Token timed out',
        };
        stepData[waitKey] = {
          type: 'token',
          tokenId,
          completed: true,
          result,
        };
        await updateStepData(pool, jobId, stepData);
        return result;
      }

      // Token not yet completed -- save pending state and throw WaitSignal
      stepData[waitKey] = { type: 'token', tokenId, completed: false };
      throw new WaitSignal('token', undefined, tokenId, stepData);
    },
  };

  return ctx;
}

/**
 * Process a single job using the provided handler map
 */
export async function processJobWithHandlers<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  backend: QueueBackend,
  job: JobRecord<PayloadMap, T>,
  jobHandlers: JobHandlers<PayloadMap>,
): Promise<void> {
  const handler = jobHandlers[job.jobType];

  if (!handler) {
    await backend.setPendingReasonForUnpickedJobs(
      `No handler registered for job type: ${job.jobType}`,
      job.jobType,
    );
    await backend.failJob(
      job.id,
      new Error(`No handler registered for job type: ${job.jobType}`),
      FailureReason.NoHandler,
    );
    return;
  }

  // Load step data (may contain completed steps from previous invocations)
  const stepData: Record<string, any> = { ...(job.stepData || {}) };

  // Try to get pool for wait features (PostgreSQL-only)
  const pool = tryExtractPool(backend);

  // If resuming from a wait, resolve any pending wait entries
  const hasStepHistory = Object.keys(stepData).some((k) =>
    k.startsWith('__wait_'),
  );
  if (hasStepHistory && pool) {
    await resolveCompletedWaits(pool, stepData);
    // Persist the resolved step data
    await updateStepData(pool, job.id, stepData);
  }

  // Per-job timeout logic
  const timeoutMs = job.timeoutMs ?? undefined;
  const forceKillOnTimeout = job.forceKillOnTimeout ?? false;
  let timeoutId: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    // If forceKillOnTimeout is true, run handler in a worker thread
    // Note: wait features are not available in forceKillOnTimeout mode
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
            try {
              const extension = onTimeoutCallback();
              if (typeof extension === 'number' && extension > 0) {
                // Extend: re-arm timeout and update DB
                backend.prolongJob(job.id).catch(() => {});
                armTimeout(extension);
                return;
              }
            } catch (callbackError) {
              log(
                `onTimeout callback threw for job ${job.id}: ${callbackError}`,
              );
              // Treat as "no extension" and proceed with abort
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

      // Build base prolong/onTimeout context
      const baseCtx = hasTimeout
        ? {
            prolong: (ms?: number) => {
              const duration = ms ?? timeoutMs;
              if (duration != null && duration > 0) {
                armTimeout(duration);
                // Update DB locked_at to prevent reclaimStuckJobs
                backend.prolongJob(job.id).catch(() => {});
              }
            },
            onTimeout: (callback: OnTimeoutCallback) => {
              onTimeoutCallback = callback;
            },
          }
        : {
            prolong: () => {
              log('prolong() called but ignored: job has no timeout set');
            },
            onTimeout: () => {
              log('onTimeout() called but ignored: job has no timeout set');
            },
          };

      // Build context: full wait support for PostgreSQL, basic for others
      const ctx = pool
        ? buildWaitContext(pool, job.id, stepData, baseCtx)
        : buildBasicContext(baseCtx);

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

    // Job completed successfully -- complete via backend
    await backend.completeJob(job.id);
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    // Check if this is a WaitSignal (not a real error)
    if (error instanceof WaitSignal) {
      if (!pool) {
        // Wait signals should never happen with non-PostgreSQL backends
        // since the context methods throw, but guard just in case
        await backend.failJob(
          job.id,
          new Error(
            'WaitSignal received but wait features require the PostgreSQL backend.',
          ),
          FailureReason.HandlerError,
        );
        return;
      }
      log(
        `Job ${job.id} entering wait: type=${error.type}, waitUntil=${error.waitUntil?.toISOString() ?? 'none'}, tokenId=${error.tokenId ?? 'none'}`,
      );
      await waitJob(pool, job.id, {
        waitUntil: error.waitUntil,
        waitTokenId: error.tokenId,
        stepData: error.stepData,
      });
      return;
    }

    // Real error -- handle as failure
    console.error(`Error processing job ${job.id}:`, error);
    let failureReason = FailureReason.HandlerError;
    if (
      error &&
      typeof error === 'object' &&
      'failureReason' in error &&
      (error as { failureReason?: FailureReason }).failureReason ===
        FailureReason.Timeout
    ) {
      failureReason = FailureReason.Timeout;
    }
    await backend.failJob(
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
  backend: QueueBackend,
  workerId: string,
  batchSize: number,
  jobType: string | string[] | undefined,
  jobHandlers: JobHandlers<PayloadMap>,
  concurrency?: number,
  onError?: (error: Error) => void,
): Promise<number> {
  const jobs = await backend.getNextBatch<PayloadMap, JobType<PayloadMap>>(
    workerId,
    batchSize,
    jobType,
  );
  if (!concurrency || concurrency >= jobs.length) {
    // Default: all in parallel
    await Promise.all(
      jobs.map((job) => processJobWithHandlers(backend, job, jobHandlers)),
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
        processJobWithHandlers(backend, job, jobHandlers)
          .then(() => {
            running--;
            finished++;
            next();
          })
          .catch((err) => {
            running--;
            finished++;
            if (onError) {
              onError(err instanceof Error ? err : new Error(String(err)));
            }
            next();
          });
      }
    };
    next();
  });
}

/**
 * Start a job processor that continuously processes jobs
 * @param backend - The queue backend
 * @param handlers - The job handlers for this processor instance
 * @param options - The processor options. Leave pollInterval empty to run only once. Use jobType to filter jobs by type.
 * @returns {Processor} The processor instance
 */
export const createProcessor = <PayloadMap = any>(
  backend: QueueBackend,
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
  let currentBatchPromise: Promise<number> | null = null;

  setLogContext(options.verbose ?? false);

  const processJobs = async (): Promise<number> => {
    if (!running) return 0;

    log(
      `Processing jobs with workerId: ${workerId}${jobType ? ` and jobType: ${Array.isArray(jobType) ? jobType.join(',') : jobType}` : ''}`,
    );

    try {
      const processed = await processBatchWithHandlers(
        backend,
        workerId,
        batchSize,
        jobType,
        handlers,
        concurrency,
        onError,
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

      // Single serialized loop: process a batch, then either immediately
      // continue (if full batch was returned) or wait pollInterval.
      const scheduleNext = (immediate: boolean) => {
        if (!running) return;
        if (immediate) {
          intervalId = setTimeout(loop, 0);
        } else {
          intervalId = setTimeout(loop, pollInterval);
        }
      };

      const loop = async () => {
        if (!running) return;
        currentBatchPromise = processJobs();
        const processed = await currentBatchPromise;
        currentBatchPromise = null;
        // If we got a full batch, there may be more work — process immediately
        scheduleNext(processed === batchSize);
      };

      // Start the first iteration immediately
      loop();
    },
    /**
     * Stop the job processor that runs in the background.
     * Does not wait for in-flight jobs.
     */
    stop: () => {
      log(`Stopping job processor with workerId: ${workerId}`);
      running = false;
      if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
      }
    },
    /**
     * Stop the job processor and wait for all in-flight jobs to complete.
     * Useful for graceful shutdown (e.g., SIGTERM handling).
     */
    stopAndDrain: async (drainTimeoutMs = 30000) => {
      log(`Stopping and draining job processor with workerId: ${workerId}`);
      running = false;
      if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
      }
      // Wait for current batch to finish, with a timeout
      if (currentBatchPromise) {
        await Promise.race([
          currentBatchPromise.catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs)),
        ]);
        currentBatchPromise = null;
      }
      log(`Job processor ${workerId} drained`);
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
