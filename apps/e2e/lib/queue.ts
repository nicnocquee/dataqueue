import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';

/**
 * Payload map for e2e test job types.
 * Each handler's behavior is controlled by the payload so tests can drive outcomes.
 */
export type TestPayloadMap = {
  /** Completes immediately */
  'fast-job': { value: string };
  /** Sleeps for delayMs before completing */
  'slow-job': { value: string; delayMs: number };
  /** Throws if shouldFail is true */
  'failing-job': { value: string; shouldFail: boolean };
  /** Runs a busy loop for runForMs (to test timeouts) */
  'timeout-job': { value: string; runForMs: number };
  /** Uses ctx.run() for each step name */
  'step-job': { value: string; steps: string[] };
  /** Uses ctx.createToken() + ctx.waitForToken() */
  'token-job': { value: string };
};

let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>> | null = null;

export const getJobQueue = () => {
  if (!jobQueue) {
    jobQueue = initJobQueue<TestPayloadMap>({
      databaseConfig: {
        connectionString:
          process.env.PG_DATAQUEUE_DATABASE ||
          'postgres://postgres:postgres@localhost:5432/e2e_test',
      },
      verbose: false,
    });
  }
  return jobQueue;
};

/**
 * Job handlers for e2e tests.
 * Behavior is driven by the payload so tests control the outcome.
 */
export const jobHandlers: JobHandlers<TestPayloadMap> = {
  'fast-job': async (_payload, _signal, _ctx) => {
    // Completes immediately
  },

  'slow-job': async (payload, signal, _ctx) => {
    const start = Date.now();
    while (Date.now() - start < payload.delayMs) {
      if (signal.aborted) throw new Error('Job aborted');
      await new Promise((r) => setTimeout(r, 50));
    }
  },

  'failing-job': async (payload, _signal, _ctx) => {
    if (payload.shouldFail) {
      throw new Error('Intentional failure for testing');
    }
  },

  'timeout-job': async (payload, signal, _ctx) => {
    const start = Date.now();
    while (Date.now() - start < payload.runForMs) {
      if (signal.aborted) throw new Error('Job timed out');
      await new Promise((r) => setTimeout(r, 50));
    }
  },

  'step-job': async (payload, _signal, ctx) => {
    const results: string[] = [];
    for (const step of payload.steps) {
      const result = await ctx.run(step, async () => {
        return `completed-${step}`;
      });
      results.push(result);
    }
    // All steps completed
  },

  'token-job': async (_payload, _signal, ctx) => {
    const token = await ctx.createToken({ timeout: '5m' });
    const result = await ctx.waitForToken(token.id);
    if (!result.ok) {
      throw new Error(`Token wait failed: ${result.error}`);
    }
  },
};
