import { test, expect } from '@playwright/test';
import { addJob, getJob, cancelJob, processJobs, bulkCancel } from './helpers';

test.describe('Job Cancellation', () => {
  test('cancel a pending job', async ({ request }) => {
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'cancel-test' },
    });

    await cancelJob(request, id);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('cancelled');
  });

  test('cancelled job is not processed', async ({ request }) => {
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'cancel-no-process' },
    });

    await cancelJob(request, id);
    await processJobs(request);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('cancelled');
  });

  test('bulk cancel multiple pending jobs', async ({ request }) => {
    // Add several jobs
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await addJob(request, {
        jobType: 'fast-job',
        payload: { value: `bulk-cancel-${i}` },
        tags: ['bulk-cancel-test'],
      });
      ids.push(id);
    }

    // Bulk cancel by tag
    const { cancelled } = await bulkCancel(request, {
      tags: { values: ['bulk-cancel-test'], mode: 'all' },
    });
    expect(cancelled).toBeGreaterThanOrEqual(3);

    // Verify all cancelled
    for (const id of ids) {
      const { job } = await getJob(request, id);
      expect(job.status).toBe('cancelled');
    }
  });
});
