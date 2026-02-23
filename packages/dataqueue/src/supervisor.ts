import { QueueBackend } from './backend.js';
import { setLogContext, log } from './log-context.js';
import {
  Supervisor,
  SupervisorOptions,
  SupervisorRunResult,
  QueueEmitFn,
} from './types.js';

/**
 * Creates a background supervisor that periodically runs maintenance tasks:
 * reclaiming stuck jobs, cleaning up old jobs/events, and expiring
 * timed-out waitpoint tokens.
 *
 * @param backend - The queue backend (Postgres or Redis) to run maintenance against.
 * @param options - Configuration for intervals, retention, and feature toggles.
 * @param emit - Optional callback to emit events to the queue's EventEmitter.
 * @returns A {@link Supervisor} with `start`, `startInBackground`, `stop`,
 *   `stopAndDrain`, and `isRunning` methods.
 */
export const createSupervisor = (
  backend: QueueBackend,
  options: SupervisorOptions = {},
  emit?: QueueEmitFn,
): Supervisor => {
  const {
    intervalMs = 60_000,
    stuckJobsTimeoutMinutes = 10,
    cleanupJobsDaysToKeep = 30,
    cleanupEventsDaysToKeep = 30,
    cleanupBatchSize = 1000,
    reclaimStuckJobs = true,
    expireTimedOutTokens = true,
    onError = (error: Error) =>
      console.error('Supervisor maintenance error:', error),
    verbose = false,
  } = options;

  let running = false;
  let timeoutId: NodeJS.Timeout | null = null;
  let currentRunPromise: Promise<SupervisorRunResult> | null = null;

  setLogContext(verbose);

  /**
   * Executes every maintenance task once, isolating failures so one
   * broken task does not prevent the others from running.
   */
  const runOnce = async (): Promise<SupervisorRunResult> => {
    setLogContext(verbose);

    const result: SupervisorRunResult = {
      reclaimedJobs: 0,
      cleanedUpJobs: 0,
      cleanedUpEvents: 0,
      expiredTokens: 0,
    };

    if (reclaimStuckJobs) {
      try {
        result.reclaimedJobs = await backend.reclaimStuckJobs(
          stuckJobsTimeoutMinutes,
        );
        if (result.reclaimedJobs > 0) {
          log(`Supervisor: reclaimed ${result.reclaimedJobs} stuck jobs`);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError(err);
        emit?.('error', err);
      }
    }

    if (cleanupJobsDaysToKeep > 0) {
      try {
        result.cleanedUpJobs = await backend.cleanupOldJobs(
          cleanupJobsDaysToKeep,
          cleanupBatchSize,
        );
        if (result.cleanedUpJobs > 0) {
          log(`Supervisor: cleaned up ${result.cleanedUpJobs} old jobs`);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError(err);
        emit?.('error', err);
      }
    }

    if (cleanupEventsDaysToKeep > 0) {
      try {
        result.cleanedUpEvents = await backend.cleanupOldJobEvents(
          cleanupEventsDaysToKeep,
          cleanupBatchSize,
        );
        if (result.cleanedUpEvents > 0) {
          log(
            `Supervisor: cleaned up ${result.cleanedUpEvents} old job events`,
          );
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError(err);
        emit?.('error', err);
      }
    }

    if (expireTimedOutTokens) {
      try {
        result.expiredTokens = await backend.expireTimedOutWaitpoints();
        if (result.expiredTokens > 0) {
          log(`Supervisor: expired ${result.expiredTokens} timed-out tokens`);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError(err);
        emit?.('error', err);
      }
    }

    return result;
  };

  return {
    start: async () => {
      return runOnce();
    },

    startInBackground: () => {
      if (running) return;
      log('Supervisor: starting background maintenance loop');
      running = true;

      const loop = async () => {
        if (!running) return;
        currentRunPromise = runOnce();
        await currentRunPromise;
        currentRunPromise = null;
        if (running) {
          timeoutId = setTimeout(loop, intervalMs);
        }
      };

      loop();
    },

    stop: () => {
      running = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      log('Supervisor: stopped');
    },

    stopAndDrain: async (timeoutMs = 30_000) => {
      running = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (currentRunPromise) {
        log('Supervisor: draining current maintenance run…');
        await Promise.race([
          currentRunPromise,
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
        currentRunPromise = null;
      }

      log('Supervisor: drained and stopped');
    },

    isRunning: () => running,
  };
};
