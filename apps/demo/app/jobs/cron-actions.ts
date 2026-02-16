'use server';

import { getJobQueue, type JobPayloadMap } from '@/lib/queue';
import type {
  CronScheduleRecord,
  CronScheduleStatus,
  JobType,
} from '@nicnocquee/dataqueue';

/** Add a cron schedule. */
export async function addCronSchedule(data: {
  scheduleName: string;
  cronExpression: string;
  jobType: string;
  payload: Record<string, unknown>;
  timezone?: string;
  allowOverlap?: boolean;
}) {
  const queue = getJobQueue();
  const id = await queue.addCronJob({
    scheduleName: data.scheduleName,
    cronExpression: data.cronExpression,
    jobType: data.jobType as JobType<JobPayloadMap>,
    payload: data.payload as JobPayloadMap[JobType<JobPayloadMap>],
    timezone: data.timezone,
    allowOverlap: data.allowOverlap,
  });
  return { id };
}

/** List cron schedules, optionally filtered by status. */
export async function listCronSchedules(status?: CronScheduleStatus) {
  const queue = getJobQueue();
  const schedules = await queue.listCronJobs(status);
  return { schedules: schedules as CronScheduleRecord[] };
}

/** Pause a cron schedule. */
export async function pauseCronSchedule(id: number) {
  const queue = getJobQueue();
  await queue.pauseCronJob(id);
  return { success: true };
}

/** Resume a cron schedule. */
export async function resumeCronSchedule(id: number) {
  const queue = getJobQueue();
  await queue.resumeCronJob(id);
  return { success: true };
}

/** Remove a cron schedule. */
export async function removeCronSchedule(id: number) {
  const queue = getJobQueue();
  await queue.removeCronJob(id);
  return { success: true };
}

/** Enqueue all due cron jobs. */
export async function enqueueDueCronJobs() {
  const queue = getJobQueue();
  const enqueued = await queue.enqueueDueCronJobs();
  return { enqueued };
}
