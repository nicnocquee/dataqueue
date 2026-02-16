import type {
  JobQueue,
  JobHandlers,
  ProcessorOptions,
} from '@nicnocquee/dataqueue';

/**
 * Configuration for the dataqueue dashboard.
 */
export interface DashboardConfig<PayloadMap = any> {
  /**
   * The initialized JobQueue instance.
   */
  jobQueue: JobQueue<PayloadMap>;
  /**
   * Job handlers used when manually triggering processing from the dashboard.
   */
  jobHandlers: JobHandlers<PayloadMap>;
  /**
   * The base path where the dashboard is mounted (e.g., '/admin/dataqueue').
   * Used for routing and generating links.
   */
  basePath: string;
  /**
   * Options for the processor when manually triggering job processing.
   * Defaults to { batchSize: 10 }.
   */
  processorOptions?: Omit<ProcessorOptions, 'workerId'>;
}

/**
 * API response for the jobs list endpoint.
 */
export interface JobsListResponse {
  jobs: SerializedJobRecord[];
  hasMore: boolean;
}

/**
 * API response for a single job.
 */
export interface JobDetailResponse {
  job: SerializedJobRecord;
}

/**
 * API response for job events.
 */
export interface JobEventsResponse {
  events: SerializedJobEvent[];
}

/**
 * API response for process action.
 */
export interface ProcessResponse {
  processed: number;
}

/**
 * API response for cancel/retry actions.
 */
export interface ActionResponse {
  ok: boolean;
  error?: string;
}

/**
 * Serialized job record with dates as ISO strings (for JSON transport).
 */
export interface SerializedJobRecord {
  id: number;
  jobType: string;
  payload: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  priority: number;
  runAt: string;
  pendingReason?: string | null;
  errorHistory?: { message: string; timestamp: string }[];
  timeoutMs?: number | null;
  forceKillOnTimeout?: boolean | null;
  failureReason?: string | null;
  completedAt: string | null;
  startedAt: string | null;
  lastRetriedAt: string | null;
  lastFailedAt: string | null;
  lastCancelledAt: string | null;
  tags?: string[];
  idempotencyKey?: string | null;
  waitUntil?: string | null;
  waitTokenId?: string | null;
  stepData?: Record<string, unknown>;
  progress?: number | null;
}

/**
 * Serialized job event with dates as ISO strings.
 */
export interface SerializedJobEvent {
  id: number;
  jobId: number;
  eventType: string;
  createdAt: string;
  metadata: unknown;
}
