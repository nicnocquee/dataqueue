import { APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:3099';

export async function addJob(
  request: APIRequestContext,
  options: {
    jobType: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    priority?: number;
    runAt?: string;
    timeoutMs?: number;
    forceKillOnTimeout?: boolean;
    tags?: string[];
    idempotencyKey?: string;
  },
) {
  const res = await request.post(`${BASE}/api/jobs`, { data: options });
  return res.json() as Promise<{ id: number }>;
}

export async function getJob(request: APIRequestContext, id: number) {
  const res = await request.get(`${BASE}/api/jobs/${id}`);
  return res.json() as Promise<{ job: Record<string, any> }>;
}

export async function getJobs(
  request: APIRequestContext,
  params?: Record<string, string>,
) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await request.get(`${BASE}/api/jobs${qs}`);
  return res.json() as Promise<{ jobs: Record<string, any>[] }>;
}

export async function editJob(
  request: APIRequestContext,
  id: number,
  updates: Record<string, unknown>,
) {
  const res = await request.patch(`${BASE}/api/jobs/${id}`, { data: updates });
  return res.json() as Promise<{ success: boolean }>;
}

export async function cancelJob(request: APIRequestContext, id: number) {
  const res = await request.post(`${BASE}/api/jobs/${id}/cancel`);
  return res.json() as Promise<{ success: boolean }>;
}

export async function retryJob(request: APIRequestContext, id: number) {
  const res = await request.post(`${BASE}/api/jobs/${id}/retry`);
  return res.json() as Promise<{ success: boolean }>;
}

export async function getJobEvents(request: APIRequestContext, id: number) {
  const res = await request.get(`${BASE}/api/jobs/${id}/events`);
  return res.json() as Promise<{ events: Record<string, any>[] }>;
}

export async function processJobs(
  request: APIRequestContext,
  options?: { batchSize?: number; concurrency?: number; jobType?: string },
) {
  const res = await request.post(`${BASE}/api/process`, {
    data: options || {},
  });
  return res.json() as Promise<{ processed: number }>;
}

export async function cleanupOldJobs(
  request: APIRequestContext,
  daysToKeep?: number,
) {
  const res = await request.post(`${BASE}/api/maintenance/cleanup`, {
    data: { daysToKeep },
  });
  return res.json() as Promise<{ deleted: number }>;
}

export async function reclaimStuckJobs(
  request: APIRequestContext,
  maxProcessingTimeMinutes?: number,
) {
  const res = await request.post(`${BASE}/api/maintenance/reclaim`, {
    data: { maxProcessingTimeMinutes },
  });
  return res.json() as Promise<{ reclaimed: number }>;
}

export async function bulkCancel(
  request: APIRequestContext,
  filters?: Record<string, unknown>,
) {
  const res = await request.post(`${BASE}/api/bulk/cancel`, {
    data: { filters },
  });
  return res.json() as Promise<{ cancelled: number }>;
}

export async function bulkEdit(
  request: APIRequestContext,
  filters: Record<string, unknown> | undefined,
  updates: Record<string, unknown>,
) {
  const res = await request.post(`${BASE}/api/bulk/edit`, {
    data: { filters, updates },
  });
  return res.json() as Promise<{ updated: number }>;
}

export async function createToken(
  request: APIRequestContext,
  options?: { timeout?: string; tags?: string[] },
) {
  const res = await request.post(`${BASE}/api/tokens`, {
    data: options || {},
  });
  return res.json() as Promise<{ token: { id: string } }>;
}

export async function getToken(request: APIRequestContext, id: string) {
  const res = await request.get(`${BASE}/api/tokens/${id}`);
  return res.json() as Promise<{ token: Record<string, any> }>;
}

export async function completeToken(
  request: APIRequestContext,
  id: string,
  data?: unknown,
) {
  const res = await request.post(`${BASE}/api/tokens/${id}/complete`, {
    data: { data },
  });
  return res.json() as Promise<{ success: boolean }>;
}

export async function expireTokens(request: APIRequestContext) {
  const res = await request.post(`${BASE}/api/tokens/expire`);
  return res.json() as Promise<{ expired: number }>;
}

/**
 * Poll until a job reaches the expected status, with timeout.
 */
export async function waitForJobStatus(
  request: APIRequestContext,
  jobId: number,
  expectedStatus: string,
  timeoutMs = 10_000,
  pollMs = 200,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { job } = await getJob(request, jobId);
    if (job.status === expectedStatus) return job;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const { job } = await getJob(request, jobId);
  throw new Error(
    `Job ${jobId} did not reach status "${expectedStatus}" within ${timeoutMs}ms. Current status: "${job.status}"`,
  );
}
