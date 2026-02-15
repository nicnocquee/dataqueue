'use server';

import { getJobQueue } from '@/lib/queue';

export const getJobEventsAction = async (jobId: number) => {
  const jobQueue = getJobQueue();
  const events = await jobQueue.getJobEvents(jobId);
  return events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    createdAt: e.createdAt.toISOString(),
    metadata: e.metadata,
  }));
};
