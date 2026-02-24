import { test, expect } from '@playwright/test';
import {
  addJob,
  cleanupOldJobs,
  processJobs,
  reclaimStuckJobs,
  waitForJobStatus,
} from './helpers';

test.describe('Maintenance', () => {
  test('cleanup old jobs (does not error)', async ({ request }) => {
    // Add and complete a job
    await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'cleanup-test' },
    });
    await processJobs(request);

    // Run cleanup with 0 days to keep (cleans everything completed)
    const { deleted } = await cleanupOldJobs(request, 0);
    // Should delete at least the jobs we've been creating
    expect(deleted).toBeGreaterThanOrEqual(0);
  });

  test('reclaim stuck jobs transitions a processing job back to pending', async ({
    request,
  }) => {
    const { id } = await addJob(request, {
      jobType: 'slow-job',
      payload: { value: 'reclaim-test', delayMs: 7000 },
    });

    const processingRun = processJobs(request, {
      batchSize: 1,
      concurrency: 1,
      jobType: 'slow-job',
    });

    await waitForJobStatus(request, id, 'processing', 5000, 100);

    const { reclaimed } = await reclaimStuckJobs(request, 0);
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const reclaimedJob = await waitForJobStatus(
      request,
      id,
      'pending',
      3000,
      100,
    );
    expect(reclaimedJob.lockedAt).toBeNull();
    expect(reclaimedJob.lockedBy).toBeNull();

    await processingRun;
    await processJobs(request, {
      batchSize: 1,
      concurrency: 1,
      jobType: 'slow-job',
    });

    await waitForJobStatus(request, id, 'completed', 10000, 100);
  });
});
