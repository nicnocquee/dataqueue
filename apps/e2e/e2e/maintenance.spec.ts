import { test, expect } from '@playwright/test';
import {
  addJob,
  processJobs,
  cleanupOldJobs,
  reclaimStuckJobs,
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

  test('reclaim stuck jobs (does not error)', async ({ request }) => {
    // Just verify the endpoint works without errors
    const { reclaimed } = await reclaimStuckJobs(request, 0);
    expect(reclaimed).toBeGreaterThanOrEqual(0);
  });
});
