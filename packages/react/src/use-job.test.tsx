import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJob } from './use-job.js';
import { DataqueueProvider } from './context.js';
import type { JobData, JobFetcher } from './types.js';

function createJob(overrides?: Partial<JobData>): JobData {
  return {
    id: 1,
    status: 'pending',
    progress: null,
    ...overrides,
  };
}

/**
 * Flush microtasks by advancing fake timers by 0 and awaiting.
 * This lets React process state updates from resolved promises.
 */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns loading state initially', () => {
    // Setup
    const fetcher = vi.fn(() => new Promise<JobData>(() => {}));

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher }));

    // Assert
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.status).toBe(null);
    expect(result.current.progress).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('fetches job data and returns it', async () => {
    // Setup
    const job = createJob({ status: 'processing', progress: 42 });
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(job);

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher }));
    await flush();

    // Assert
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(job);
    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(42);
    expect(result.current.error).toBe(null);
    expect(fetcher).toHaveBeenCalledWith(1);
  });

  it('returns error when fetcher throws', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockRejectedValue(new Error('Network error'));

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher }));
    await flush();

    // Assert
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.data).toBe(null);
  });

  it('skips polling when jobId is null', () => {
    // Setup
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(createJob());

    // Act
    const { result } = renderHook(() => useJob(null, { fetcher }));

    // Assert
    expect(result.current.isLoading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('skips polling when enabled is false', () => {
    // Setup
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(createJob());

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher, enabled: false }));

    // Assert
    expect(result.current.isLoading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('polls at the configured interval', async () => {
    // Setup
    const job = createJob({ status: 'processing', progress: 10 });
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(job);

    // Act - initial fetch
    renderHook(() => useJob(1, { fetcher, pollingInterval: 500 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance timer for one poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Assert
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops polling when job reaches completed status', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'completed' }));

    // Act
    renderHook(() => useJob(1, { fetcher, pollingInterval: 500 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance well past multiple polling intervals
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Assert - should not have polled again after terminal status
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops polling when job reaches failed status', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'failed' }));

    // Act
    renderHook(() => useJob(1, { fetcher, pollingInterval: 500 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Assert
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops polling when job reaches cancelled status', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'cancelled' }));

    // Act
    renderHook(() => useJob(1, { fetcher, pollingInterval: 500 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Assert
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('calls onStatusChange when status changes', async () => {
    // Setup
    const onStatusChange = vi.fn();
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValueOnce(createJob({ status: 'processing' }))
      .mockResolvedValueOnce(createJob({ status: 'completed' }));

    // Act
    renderHook(() =>
      useJob(1, { fetcher, pollingInterval: 500, onStatusChange }),
    );
    await flush();

    // Assert - first status change from null to 'processing'
    expect(onStatusChange).toHaveBeenCalledWith('processing', null);

    // Advance to trigger second fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Assert - second status change from 'processing' to 'completed'
    expect(onStatusChange).toHaveBeenCalledWith('completed', 'processing');
    expect(onStatusChange).toHaveBeenCalledTimes(2);
  });

  it('calls onComplete when job completes', async () => {
    // Setup
    const onComplete = vi.fn();
    const completedJob = createJob({ status: 'completed' });
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(completedJob);

    // Act
    renderHook(() => useJob(1, { fetcher, onComplete }));
    await flush();

    // Assert
    expect(onComplete).toHaveBeenCalledWith(completedJob);
  });

  it('calls onFailed when job fails', async () => {
    // Setup
    const onFailed = vi.fn();
    const failedJob = createJob({ status: 'failed' });
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(failedJob);

    // Act
    renderHook(() => useJob(1, { fetcher, onFailed }));
    await flush();

    // Assert
    expect(onFailed).toHaveBeenCalledWith(failedJob);
  });

  it('resets state when jobId changes', async () => {
    // Setup
    const job1 = createJob({ id: 1, status: 'completed' });
    const job2 = createJob({ id: 2, status: 'processing', progress: 50 });
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValueOnce(job1)
      .mockResolvedValueOnce(job2);

    // Act - start with jobId 1
    const { result, rerender } = renderHook(
      ({ jobId }) => useJob(jobId, { fetcher }),
      { initialProps: { jobId: 1 as number } },
    );
    await flush();
    expect(result.current.status).toBe('completed');

    // Act - switch to jobId 2
    rerender({ jobId: 2 });
    await flush();

    // Assert
    expect(result.current.data).toEqual(job2);
    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(50);
  });

  it('uses fetcher from DataqueueProvider', async () => {
    // Setup
    const job = createJob({ status: 'processing' });
    const fetcher = vi.fn<JobFetcher>().mockResolvedValue(job);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataqueueProvider fetcher={fetcher}>{children}</DataqueueProvider>
    );

    // Act
    const { result } = renderHook(() => useJob(1), { wrapper });
    await flush();

    // Assert
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('processing');
    expect(fetcher).toHaveBeenCalledWith(1);
  });

  it('uses pollingInterval from DataqueueProvider', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'processing' }));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataqueueProvider fetcher={fetcher} pollingInterval={2000}>
        {children}
      </DataqueueProvider>
    );

    // Act
    renderHook(() => useJob(1), { wrapper });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance 1s - should NOT have polled again (interval is 2s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance another 1s (total 2s) - should poll now
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Assert
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('hook options override provider config', async () => {
    // Setup
    const providerFetcher = vi.fn<JobFetcher>().mockResolvedValue(createJob());
    const hookFetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'completed' }));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataqueueProvider fetcher={providerFetcher} pollingInterval={5000}>
        {children}
      </DataqueueProvider>
    );

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher: hookFetcher }), {
      wrapper,
    });
    await flush();

    // Assert - hook fetcher was used, not provider fetcher
    expect(result.current.isLoading).toBe(false);
    expect(hookFetcher).toHaveBeenCalled();
    expect(providerFetcher).not.toHaveBeenCalled();
  });

  it('does not call onComplete for non-completed statuses', async () => {
    // Setup
    const onComplete = vi.fn();
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValue(createJob({ status: 'processing' }));

    // Act
    renderHook(() => useJob(1, { fetcher, onComplete }));
    await flush();

    // Assert
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('tracks progress updates across polls', async () => {
    // Setup
    const fetcher = vi
      .fn<JobFetcher>()
      .mockResolvedValueOnce(createJob({ status: 'processing', progress: 25 }))
      .mockResolvedValueOnce(createJob({ status: 'processing', progress: 75 }))
      .mockResolvedValueOnce(createJob({ status: 'completed', progress: 100 }));

    // Act
    const { result } = renderHook(() =>
      useJob(1, { fetcher, pollingInterval: 500 }),
    );
    await flush();
    expect(result.current.progress).toBe(25);

    // Advance to second poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.progress).toBe(75);

    // Advance to third poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Assert
    expect(result.current.progress).toBe(100);
    expect(result.current.status).toBe('completed');
  });

  it('wraps non-Error exceptions in an Error object', async () => {
    // Setup
    const fetcher = vi.fn<JobFetcher>().mockRejectedValue('string error');

    // Act
    const { result } = renderHook(() => useJob(1, { fetcher }));
    await flush();

    // Assert
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string error');
  });
});
