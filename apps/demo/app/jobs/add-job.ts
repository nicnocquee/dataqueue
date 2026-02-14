'use server';

import { getJobQueue, type JobPayloadMap } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const addGenericJob = async ({
  jobType,
  payload,
  priority,
  tags,
  idempotencyKey,
  runAtDelay,
  timeoutMs,
  forceKillOnTimeout,
  maxAttempts,
}: {
  jobType: keyof JobPayloadMap;
  payload: JobPayloadMap[keyof JobPayloadMap];
  priority?: number;
  tags?: string[];
  idempotencyKey?: string;
  runAtDelay?: number; // seconds from now
  timeoutMs?: number;
  forceKillOnTimeout?: boolean;
  maxAttempts?: number;
}) => {
  const jobQueue = getJobQueue();
  const runAt = runAtDelay
    ? new Date(Date.now() + runAtDelay * 1000)
    : undefined;

  const job = await jobQueue.addJob({
    jobType,
    payload: payload as never,
    priority: priority ?? 5,
    tags: tags && tags.length > 0 ? tags : undefined,
    idempotencyKey: idempotencyKey || undefined,
    runAt: runAt ?? undefined,
    timeoutMs: timeoutMs ?? undefined,
    forceKillOnTimeout: forceKillOnTimeout ?? undefined,
    maxAttempts: maxAttempts ?? undefined,
  });

  revalidatePath('/');
  return { job };
};
