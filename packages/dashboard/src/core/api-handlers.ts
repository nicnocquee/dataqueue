import type { JobRecord, JobEvent, JobStatus } from '@nicnocquee/dataqueue';
import type {
  DashboardConfig,
  SerializedJobRecord,
  SerializedJobEvent,
} from './types.js';
import { generateDashboardHTML } from './html.js';

const DEFAULT_PAGE_SIZE = 25;

function serializeJob(job: JobRecord<any, any>): SerializedJobRecord {
  return {
    id: job.id,
    jobType: job.jobType,
    payload: job.payload,
    status: job.status,
    createdAt: toISO(job.createdAt),
    updatedAt: toISO(job.updatedAt),
    lockedAt: job.lockedAt ? toISO(job.lockedAt) : null,
    lockedBy: job.lockedBy,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt ? toISO(job.nextAttemptAt) : null,
    priority: job.priority,
    runAt: toISO(job.runAt),
    pendingReason: job.pendingReason,
    errorHistory: job.errorHistory,
    timeoutMs: job.timeoutMs,
    forceKillOnTimeout: job.forceKillOnTimeout,
    failureReason: job.failureReason,
    completedAt: job.completedAt ? toISO(job.completedAt) : null,
    startedAt: job.startedAt ? toISO(job.startedAt) : null,
    lastRetriedAt: job.lastRetriedAt ? toISO(job.lastRetriedAt) : null,
    lastFailedAt: job.lastFailedAt ? toISO(job.lastFailedAt) : null,
    lastCancelledAt: job.lastCancelledAt ? toISO(job.lastCancelledAt) : null,
    tags: job.tags,
    idempotencyKey: job.idempotencyKey,
    waitUntil: job.waitUntil ? toISO(job.waitUntil) : null,
    waitTokenId: job.waitTokenId,
    stepData: job.stepData,
    progress: job.progress,
  };
}

function serializeEvent(event: JobEvent): SerializedJobEvent {
  return {
    id: event.id,
    jobId: event.jobId,
    eventType: event.eventType,
    createdAt: toISO(event.createdAt),
    metadata: event.metadata,
  };
}

function toISO(date: Date | string): string {
  if (date instanceof Date) return date.toISOString();
  return date;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Parse the path segments after the base path.
 * E.g., for basePath="/admin/dq" and URL "/admin/dq/api/jobs/5",
 * returns ["api", "jobs", "5"].
 */
function parsePathSegments(url: string, basePath: string): string[] {
  const u = new URL(url);
  const normalized = basePath.endsWith('/') ? basePath : basePath + '/';
  const rest = u.pathname.startsWith(normalized)
    ? u.pathname.slice(normalized.length)
    : u.pathname.slice(basePath.length);
  return rest
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Handle an incoming request and return a Response.
 * This is the framework-agnostic core of the dashboard.
 */
export async function handleRequest(
  request: Request,
  config: DashboardConfig,
): Promise<Response> {
  const { jobQueue, basePath } = config;
  const method = request.method.toUpperCase();
  const segments = parsePathSegments(request.url, basePath);

  try {
    // --- GET routes ---
    if (method === 'GET') {
      // GET /api/jobs - list jobs
      if (segments[0] === 'api' && segments[1] === 'jobs' && !segments[2]) {
        const url = new URL(request.url);
        const status = url.searchParams.get('status') as JobStatus | null;
        const jobType = url.searchParams.get('jobType');
        const limit = parseInt(
          url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE),
          10,
        );
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        let jobs: JobRecord<any, any>[];

        if (status) {
          jobs = await jobQueue.getJobsByStatus(status, limit + 1, offset);
        } else if (jobType) {
          jobs = await jobQueue.getJobs({ jobType }, limit + 1, offset);
        } else {
          jobs = await jobQueue.getAllJobs(limit + 1, offset);
        }

        const hasMore = jobs.length > limit;
        if (hasMore) jobs = jobs.slice(0, limit);

        return json({
          jobs: jobs.map(serializeJob),
          hasMore,
        });
      }

      // GET /api/jobs/:id/events - job events
      if (
        segments[0] === 'api' &&
        segments[1] === 'jobs' &&
        segments[2] &&
        segments[3] === 'events'
      ) {
        const id = parseInt(segments[2], 10);
        if (isNaN(id)) return json({ error: 'Invalid job ID' }, 400);

        const events = await jobQueue.getJobEvents(id);
        return json({ events: events.map(serializeEvent) });
      }

      // GET /api/jobs/:id - single job
      if (segments[0] === 'api' && segments[1] === 'jobs' && segments[2]) {
        const id = parseInt(segments[2], 10);
        if (isNaN(id)) return json({ error: 'Invalid job ID' }, 400);

        const job = await jobQueue.getJob(id);
        if (!job) return json({ error: 'Job not found' }, 404);

        return json({ job: serializeJob(job) });
      }

      // GET / or any non-API path - serve dashboard HTML
      if (segments[0] !== 'api') {
        return html(generateDashboardHTML(basePath));
      }
    }

    // --- POST routes ---
    if (method === 'POST') {
      // POST /api/jobs/:id/cancel
      if (
        segments[0] === 'api' &&
        segments[1] === 'jobs' &&
        segments[2] &&
        segments[3] === 'cancel'
      ) {
        const id = parseInt(segments[2], 10);
        if (isNaN(id)) return json({ error: 'Invalid job ID' }, 400);

        try {
          await jobQueue.cancelJob(id);
          return json({ ok: true });
        } catch (err: any) {
          return json({ ok: false, error: err.message }, 400);
        }
      }

      // POST /api/jobs/:id/retry
      if (
        segments[0] === 'api' &&
        segments[1] === 'jobs' &&
        segments[2] &&
        segments[3] === 'retry'
      ) {
        const id = parseInt(segments[2], 10);
        if (isNaN(id)) return json({ error: 'Invalid job ID' }, 400);

        try {
          await jobQueue.retryJob(id);
          return json({ ok: true });
        } catch (err: any) {
          return json({ ok: false, error: err.message }, 400);
        }
      }

      // POST /api/process - manually trigger processing
      if (segments[0] === 'api' && segments[1] === 'process') {
        const { jobHandlers, processorOptions } = config;
        const processor = jobQueue.createProcessor(jobHandlers, {
          workerId: `dashboard-${Date.now()}`,
          batchSize: 10,
          ...processorOptions,
        });
        const processed = await processor.start();
        return json({ processed });
      }
    }

    return json({ error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('[dataqueue-dashboard] Error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}
