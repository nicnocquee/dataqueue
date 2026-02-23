'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDataqueueConfig } from './context.js';
import type {
  JobData,
  JobFetcher,
  JobStatus,
  UseJobOptions,
  UseJobReturn,
} from './types.js';
import { TERMINAL_STATUSES } from './types.js';

const DEFAULT_POLLING_INTERVAL = 1000;

/**
 * Subscribe to a job's status and progress via polling.
 *
 * @param jobId - The numeric job ID to subscribe to, or `null`/`undefined` to skip polling.
 * @param options - Optional overrides and callbacks.
 * @returns An object with `data`, `status`, `progress`, `isLoading`, and `error`.
 *
 * @example
 * ```tsx
 * const { status, progress, data, error } = useJob(jobId, {
 *   fetcher: (id) => fetch(`/api/jobs/${id}`).then(r => r.json()).then(d => d.job),
 *   pollingInterval: 1000,
 *   onComplete: (job) => console.log('Done!', job),
 * });
 * ```
 */
export function useJob(
  jobId: number | null | undefined,
  options: UseJobOptions = {},
): UseJobReturn {
  const providerConfig = useDataqueueConfig();

  // Resolve fetcher: hook option > provider > missing (will skip polling)
  const fetcher: JobFetcher | undefined =
    options.fetcher ?? providerConfig?.fetcher;

  // Resolve polling interval
  const pollingInterval =
    options.pollingInterval ??
    providerConfig?.pollingInterval ??
    DEFAULT_POLLING_INTERVAL;

  const enabled = options.enabled !== false;

  const [data, setData] = useState<JobData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(jobId != null && enabled);

  // Track previous status for onStatusChange callback
  const prevStatusRef = useRef<JobStatus | null>(null);

  // Track whether a fetch is already in-flight to avoid overlapping requests
  const inFlightRef = useRef(false);

  // Store the latest callbacks in refs so the polling effect doesn't
  // need to re-subscribe when callbacks change identity.
  const onStatusChangeRef = useRef(options.onStatusChange);
  onStatusChangeRef.current = options.onStatusChange;
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;
  const onFailedRef = useRef(options.onFailed);
  onFailedRef.current = options.onFailed;

  // Whether we've reached a terminal state and should stop polling
  const terminalRef = useRef(false);

  const fetchJob = useCallback(async () => {
    if (!fetcher || jobId == null || inFlightRef.current) return;

    inFlightRef.current = true;
    try {
      const result = await fetcher(jobId);
      setData(result);
      setError(null);
      setIsLoading(false);

      // Status change detection
      const newStatus = result.status;
      const prevStatus = prevStatusRef.current;

      if (prevStatus !== newStatus) {
        prevStatusRef.current = newStatus;
        onStatusChangeRef.current?.(newStatus, prevStatus);

        if (newStatus === 'completed') {
          onCompleteRef.current?.(result);
        } else if (newStatus === 'failed') {
          onFailedRef.current?.(result);
        }
      }

      // Stop polling on terminal status
      if (TERMINAL_STATUSES.has(newStatus)) {
        terminalRef.current = true;
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsLoading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, [fetcher, jobId]);

  // Reset state when jobId changes
  useEffect(() => {
    setData(null);
    setError(null);
    prevStatusRef.current = null;
    terminalRef.current = false;
    inFlightRef.current = false;
    setIsLoading(jobId != null && enabled);
  }, [jobId, enabled]);

  // Main polling effect
  useEffect(() => {
    if (!fetcher || jobId == null || !enabled) return;

    // Initial fetch immediately
    fetchJob();

    const id = setInterval(() => {
      if (!terminalRef.current) {
        fetchJob();
      }
    }, pollingInterval);

    return () => clearInterval(id);
  }, [fetchJob, pollingInterval, jobId, enabled, fetcher]);

  return {
    data,
    status: data?.status ?? null,
    progress: data?.progress ?? null,
    output: data?.output ?? null,
    isLoading,
    error,
  };
}
