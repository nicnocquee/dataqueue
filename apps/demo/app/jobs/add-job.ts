'use server';

import { getJobQueue, type JobPayloadMap } from '@/lib/queue';
import { revalidatePath } from 'next/cache';
import type { JobDependsOn } from '@nicnocquee/dataqueue';

/**
 * Enqueues a typed job. Optionally attaches prerequisites via {@link JobDependsOn}.
 *
 * @param params - Job type, payload, and optional scheduling / dependency fields.
 * @returns The new job id (numeric) as `job`.
 */
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
  dependsOn,
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
  dependsOn?: JobDependsOn;
}) => {
  const jobQueue = getJobQueue();
  const runAt = runAtDelay
    ? new Date(Date.now() + runAtDelay * 1000)
    : undefined;

  const normalizedDependsOn: JobDependsOn | undefined =
    dependsOn &&
    ((dependsOn.jobIds?.length ?? 0) > 0 || (dependsOn.tags?.length ?? 0) > 0)
      ? {
          ...(dependsOn.jobIds?.length ? { jobIds: dependsOn.jobIds } : {}),
          ...(dependsOn.tags?.length ? { tags: dependsOn.tags } : {}),
        }
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
    dependsOn: normalizedDependsOn,
  });

  revalidatePath('/');
  revalidatePath('/features/dependencies');
  return { job };
};
