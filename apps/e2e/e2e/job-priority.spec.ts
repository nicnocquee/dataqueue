import { test, expect } from '@playwright/test';
import { addJob, getJob, processJobs } from './helpers';

test.describe('Job Priority', () => {
  test('higher priority jobs are processed first', async ({ request }) => {
    // Add jobs with different priorities (higher number = higher priority)
    const { id: lowId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'low-priority' },
      priority: 1,
      tags: ['priority-test'],
    });

    const { id: highId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'high-priority' },
      priority: 10,
      tags: ['priority-test'],
    });

    const { id: midId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'mid-priority' },
      priority: 5,
      tags: ['priority-test'],
    });

    // Process one at a time
    await processJobs(request, { batchSize: 1, concurrency: 1 });

    // The high-priority job should be completed first
    const { job: highJob } = await getJob(request, highId);
    expect(highJob.status).toBe('completed');

    // Others may or may not be completed yet depending on batch
    // Process remaining
    await processJobs(request, { batchSize: 10 });

    const { job: midJob } = await getJob(request, midId);
    const { job: lowJob } = await getJob(request, lowId);
    expect(midJob.status).toBe('completed');
    expect(lowJob.status).toBe('completed');

    // Verify high priority was completed before low priority (by completedAt)
    const highCompleted = new Date(highJob.completedAt).getTime();
    const lowCompleted = new Date(lowJob.completedAt).getTime();
    expect(highCompleted).toBeLessThanOrEqual(lowCompleted);
  });
});
