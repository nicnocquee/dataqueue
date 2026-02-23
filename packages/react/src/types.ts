/**
 * Job status values matching the core dataqueue package.
 * Redefined here so the React SDK has zero runtime dependency on the server package.
 */
export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting';

/** Terminal statuses where polling should stop automatically. */
export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Minimal job data shape returned by the fetcher.
 * Users can return a full JobRecord from the server or any object
 * that includes at least `status` and optionally `progress`.
 */
export interface JobData {
  id: number;
  status: JobStatus;
  progress?: number | null;
  output?: unknown;
  [key: string]: unknown;
}

/**
 * A fetcher function that retrieves a job by its ID.
 * Should return a `JobData`-compatible object or throw on error.
 */
export type JobFetcher = (jobId: number) => Promise<JobData>;

/**
 * Configuration provided to `DataqueueProvider`.
 */
export interface DataqueueConfig {
  /** Fetcher function to retrieve a job by ID from your API. */
  fetcher: JobFetcher;
  /** Default polling interval in milliseconds. Defaults to 1000. */
  pollingInterval?: number;
}

/**
 * Options for the `useJob` hook.
 */
export interface UseJobOptions {
  /** Override the provider's fetcher for this specific hook instance. */
  fetcher?: JobFetcher;
  /** Override the provider's polling interval (ms) for this hook instance. */
  pollingInterval?: number;
  /** Whether polling is enabled. Defaults to true. Set to false to pause. */
  enabled?: boolean;
  /** Called when the job's status changes. */
  onStatusChange?: (newStatus: JobStatus, prevStatus: JobStatus | null) => void;
  /** Called when the job reaches 'completed' status. */
  onComplete?: (data: JobData) => void;
  /** Called when the job reaches 'failed' status. */
  onFailed?: (data: JobData) => void;
}

/**
 * Return value of the `useJob` hook.
 */
export interface UseJobReturn {
  /** The full job data from the last successful fetch, or null if not yet loaded. */
  data: JobData | null;
  /** The current job status, or null if not yet loaded. */
  status: JobStatus | null;
  /** The current progress percentage (0-100), or null if not reported. */
  progress: number | null;
  /** The handler output stored via `ctx.setOutput()` or by returning a value, or null. */
  output: unknown | null;
  /** True during the initial fetch (before any data is available). */
  isLoading: boolean;
  /** The error from the last failed fetch, or null. */
  error: Error | null;
}
