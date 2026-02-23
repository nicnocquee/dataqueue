import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createSupervisor } from './supervisor.js';
import type { QueueBackend } from './backend.js';
import type { SupervisorOptions } from './types.js';

/**
 * Builds a fake {@link QueueBackend} with only the methods the supervisor
 * calls, each backed by a vi.fn() that resolves to 0 by default.
 */
function createFakeBackend(overrides: Partial<QueueBackend> = {}) {
  return {
    reclaimStuckJobs: vi.fn().mockResolvedValue(0),
    cleanupOldJobs: vi.fn().mockResolvedValue(0),
    cleanupOldJobEvents: vi.fn().mockResolvedValue(0),
    expireTimedOutWaitpoints: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as QueueBackend;
}

describe('createSupervisor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('start (one-shot)', () => {
    it('runs all maintenance tasks and returns results', async () => {
      // Setup
      const backend = createFakeBackend({
        reclaimStuckJobs: vi.fn().mockResolvedValue(3),
        cleanupOldJobs: vi.fn().mockResolvedValue(15),
        cleanupOldJobEvents: vi.fn().mockResolvedValue(7),
        expireTimedOutWaitpoints: vi.fn().mockResolvedValue(2),
      });
      const supervisor = createSupervisor(backend);

      // Act
      const result = await supervisor.start();

      // Assert
      expect(result).toEqual({
        reclaimedJobs: 3,
        cleanedUpJobs: 15,
        cleanedUpEvents: 7,
        expiredTokens: 2,
      });
      expect(backend.reclaimStuckJobs).toHaveBeenCalledWith(10);
      expect(backend.cleanupOldJobs).toHaveBeenCalledWith(30, 1000);
      expect(backend.cleanupOldJobEvents).toHaveBeenCalledWith(30, 1000);
      expect(backend.expireTimedOutWaitpoints).toHaveBeenCalledOnce();
    });

    it('passes custom option values to backend methods', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, {
        stuckJobsTimeoutMinutes: 20,
        cleanupJobsDaysToKeep: 60,
        cleanupEventsDaysToKeep: 14,
        cleanupBatchSize: 500,
      });

      // Act
      await supervisor.start();

      // Assert
      expect(backend.reclaimStuckJobs).toHaveBeenCalledWith(20);
      expect(backend.cleanupOldJobs).toHaveBeenCalledWith(60, 500);
      expect(backend.cleanupOldJobEvents).toHaveBeenCalledWith(14, 500);
    });

    it('skips reclaimStuckJobs when disabled', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, {
        reclaimStuckJobs: false,
      });

      // Act
      const result = await supervisor.start();

      // Assert
      expect(backend.reclaimStuckJobs).not.toHaveBeenCalled();
      expect(result.reclaimedJobs).toBe(0);
      expect(backend.cleanupOldJobs).toHaveBeenCalledOnce();
    });

    it('skips cleanupOldJobs when cleanupJobsDaysToKeep is 0', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, {
        cleanupJobsDaysToKeep: 0,
      });

      // Act
      const result = await supervisor.start();

      // Assert
      expect(backend.cleanupOldJobs).not.toHaveBeenCalled();
      expect(result.cleanedUpJobs).toBe(0);
      expect(backend.reclaimStuckJobs).toHaveBeenCalledOnce();
    });

    it('skips cleanupOldJobEvents when cleanupEventsDaysToKeep is 0', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, {
        cleanupEventsDaysToKeep: 0,
      });

      // Act
      const result = await supervisor.start();

      // Assert
      expect(backend.cleanupOldJobEvents).not.toHaveBeenCalled();
      expect(result.cleanedUpEvents).toBe(0);
    });

    it('skips expireTimedOutTokens when disabled', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, {
        expireTimedOutTokens: false,
      });

      // Act
      const result = await supervisor.start();

      // Assert
      expect(backend.expireTimedOutWaitpoints).not.toHaveBeenCalled();
      expect(result.expiredTokens).toBe(0);
    });

    it('calls onError and continues when a task throws', async () => {
      // Setup
      const onError = vi.fn();
      const taskError = new Error('reclaim failed');
      const backend = createFakeBackend({
        reclaimStuckJobs: vi.fn().mockRejectedValue(taskError),
        cleanupOldJobs: vi.fn().mockResolvedValue(5),
        cleanupOldJobEvents: vi
          .fn()
          .mockRejectedValue(new Error('events boom')),
        expireTimedOutWaitpoints: vi.fn().mockResolvedValue(1),
      });
      const supervisor = createSupervisor(backend, { onError });

      // Act
      const result = await supervisor.start();

      // Assert
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(taskError);
      expect(result.reclaimedJobs).toBe(0);
      expect(result.cleanedUpJobs).toBe(5);
      expect(result.cleanedUpEvents).toBe(0);
      expect(result.expiredTokens).toBe(1);
    });

    it('wraps non-Error throws in an Error object', async () => {
      // Setup
      const onError = vi.fn();
      const backend = createFakeBackend({
        reclaimStuckJobs: vi.fn().mockRejectedValue('string error'),
      });
      const supervisor = createSupervisor(backend, { onError });

      // Act
      await supervisor.start();

      // Assert
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('string error');
    });
  });

  describe('startInBackground / stop', () => {
    it('polls on interval and can be stopped', async () => {
      // Setup
      vi.useFakeTimers();
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, { intervalMs: 1000 });

      // Act
      supervisor.startInBackground();
      expect(supervisor.isRunning()).toBe(true);

      // First run is immediate (microtask)
      await vi.advanceTimersByTimeAsync(0);
      expect(backend.reclaimStuckJobs).toHaveBeenCalledTimes(1);

      // Advance to trigger second run
      await vi.advanceTimersByTimeAsync(1000);
      expect(backend.reclaimStuckJobs).toHaveBeenCalledTimes(2);

      // Advance to trigger third run
      await vi.advanceTimersByTimeAsync(1000);
      expect(backend.reclaimStuckJobs).toHaveBeenCalledTimes(3);

      // Stop
      supervisor.stop();
      expect(supervisor.isRunning()).toBe(false);

      // No more runs after stop
      await vi.advanceTimersByTimeAsync(5000);
      expect(backend.reclaimStuckJobs).toHaveBeenCalledTimes(3);
    });

    it('does nothing when called while already running', async () => {
      // Setup
      vi.useFakeTimers();
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend, { intervalMs: 1000 });

      // Act
      supervisor.startInBackground();
      supervisor.startInBackground(); // second call should be ignored
      await vi.advanceTimersByTimeAsync(0);

      // Assert -- only one loop running, single call
      expect(backend.reclaimStuckJobs).toHaveBeenCalledTimes(1);

      supervisor.stop();
    });
  });

  describe('stopAndDrain', () => {
    it('waits for current maintenance run to finish', async () => {
      // Setup
      vi.useFakeTimers();
      let resolveTask!: () => void;
      const slowTask = new Promise<number>((resolve) => {
        resolveTask = () => resolve(2);
      });
      const backend = createFakeBackend({
        reclaimStuckJobs: vi.fn().mockReturnValue(slowTask),
      });
      const supervisor = createSupervisor(backend, { intervalMs: 1000 });

      // Act
      supervisor.startInBackground();
      // Let the loop start (but reclaimStuckJobs is blocked)
      await vi.advanceTimersByTimeAsync(0);

      let drained = false;
      const drainPromise = supervisor.stopAndDrain().then(() => {
        drained = true;
      });

      // Assert -- not drained yet because slowTask is still pending
      expect(drained).toBe(false);
      expect(supervisor.isRunning()).toBe(false);

      // Resolve the slow task
      resolveTask();
      await drainPromise;

      // Assert -- now drained
      expect(drained).toBe(true);
    });

    it('resolves immediately when no maintenance run is in progress', async () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend);

      // Act & Assert
      await expect(supervisor.stopAndDrain()).resolves.toBeUndefined();
    });

    it('resolves after timeout if maintenance run hangs', async () => {
      // Setup
      vi.useFakeTimers();
      const neverResolve = new Promise<number>(() => {});
      const backend = createFakeBackend({
        reclaimStuckJobs: vi.fn().mockReturnValue(neverResolve),
      });
      const supervisor = createSupervisor(backend, { intervalMs: 5000 });

      // Act
      supervisor.startInBackground();
      await vi.advanceTimersByTimeAsync(0);

      let drained = false;
      const drainPromise = supervisor.stopAndDrain(500).then(() => {
        drained = true;
      });

      // Assert -- not drained yet
      expect(drained).toBe(false);

      // Advance past the drain timeout
      await vi.advanceTimersByTimeAsync(500);
      await drainPromise;

      // Assert -- drained by timeout
      expect(drained).toBe(true);
    });
  });

  describe('isRunning', () => {
    it('returns false before start', () => {
      // Setup
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend);

      // Assert
      expect(supervisor.isRunning()).toBe(false);
    });

    it('returns true after startInBackground', async () => {
      // Setup
      vi.useFakeTimers();
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend);

      // Act
      supervisor.startInBackground();

      // Assert
      expect(supervisor.isRunning()).toBe(true);

      supervisor.stop();
    });

    it('returns false after stop', async () => {
      // Setup
      vi.useFakeTimers();
      const backend = createFakeBackend();
      const supervisor = createSupervisor(backend);

      // Act
      supervisor.startInBackground();
      supervisor.stop();

      // Assert
      expect(supervisor.isRunning()).toBe(false);
    });
  });
});
