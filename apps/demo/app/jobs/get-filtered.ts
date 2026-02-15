'use server';

import { getJobQueue } from '@/lib/queue';
import type { TagQueryMode } from '@nicnocquee/dataqueue';

export const getFilteredJobs = async (filters: {
  jobType?: string;
  priority?: number;
  tags?: { values: string[]; mode?: TagQueryMode };
  limit?: number;
}) => {
  const jobQueue = getJobQueue();
  const jobs = await jobQueue.getJobs(
    {
      jobType: filters.jobType,
      priority: filters.priority,
      tags: filters.tags,
    },
    filters.limit ?? 50,
  );
  return jobs;
};

export const getJobsByTagsAction = async (
  tags: string[],
  mode: TagQueryMode = 'all',
  limit: number = 50,
) => {
  const jobQueue = getJobQueue();
  const jobs = await jobQueue.getJobsByTags(tags, mode, limit);
  return jobs;
};
