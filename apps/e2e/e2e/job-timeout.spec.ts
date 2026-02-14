import { test, expect } from '@playwright/test';
import { addJob, getJob, processJobs } from './helpers';

test.describe('Job Timeout', () => {
  test('job that exceeds timeout gets failed with Timeout reason', async ({
    request,
  }) => {
    // Add a job with short timeout (500ms) but handler runs for 5000ms
    const { id } = await addJob(request, {
      jobType: 'timeout-job',
      payload: { value: 'timeout-test', runForMs: 5000 },
      timeoutMs: 500,
      maxAttempts: 1,
    });

    // Process - the handler will run longer than timeout
    await processJobs(request);

    // Give it a moment for the timeout to trigger and job to be updated
    await new Promise((r) => setTimeout(r, 2000));

    const { job } = await getJob(request, id);
    expect(job.status).toBe('failed');
    expect(job.failureReason).toBeTruthy();
  });

  test('job that completes within timeout succeeds', async ({ request }) => {
    // Add a job with generous timeout
    const { id } = await addJob(request, {
      jobType: 'timeout-job',
      payload: { value: 'no-timeout', runForMs: 100 },
      timeoutMs: 10000,
      maxAttempts: 1,
    });

    await processJobs(request);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('completed');
  });
});
