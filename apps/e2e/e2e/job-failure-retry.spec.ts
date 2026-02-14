import { test, expect } from '@playwright/test';
import {
  addJob,
  getJob,
  processJobs,
  retryJob,
  editJob,
  getJobEvents,
} from './helpers';

test.describe('Job Failure and Retry', () => {
  test('failing job gets failed status after exhausting attempts', async ({
    request,
  }) => {
    // Add a job that will fail, with only 1 attempt
    const { id } = await addJob(request, {
      jobType: 'failing-job',
      payload: { value: 'fail-test', shouldFail: true },
      maxAttempts: 1,
    });

    // Process it
    await processJobs(request);

    // Verify it failed
    const { job } = await getJob(request, id);
    expect(job.status).toBe('failed');
    expect(job.failureReason).toBeTruthy();
  });

  test('retry a failed job using retryJob and it gets reprocessed', async ({
    request,
  }) => {
    // Add a job that will fail, with only 1 attempt
    const { id } = await addJob(request, {
      jobType: 'failing-job',
      payload: { value: 'retry-reprocess', shouldFail: true },
      maxAttempts: 1,
    });

    // Process - it fails
    await processJobs(request);
    const { job: failedJob } = await getJob(request, id);
    expect(failedJob.status).toBe('failed');
    expect(failedJob.attempts).toBe(1);

    // Retry the job first (sets status to 'pending'), then edit maxAttempts
    // editJob only works on pending jobs, so retry must come first
    await retryJob(request, id);
    await editJob(request, id, { maxAttempts: 2 });

    // Process again - still fails because payload.shouldFail is true
    await processJobs(request);
    const { job: failedAgain } = await getJob(request, id);
    expect(failedAgain.status).toBe('failed');
    expect(failedAgain.attempts).toBe(2);

    // Check events include a retried event
    const { events } = await getJobEvents(request, id);
    const eventTypes = events.map((e: any) => e.eventType);
    expect(eventTypes).toContain('retried');
  });

  test('retry a failed job with fixed payload and it succeeds', async ({
    request,
  }) => {
    // Add a failing job with 1 attempt
    const { id } = await addJob(request, {
      jobType: 'failing-job',
      payload: { value: 'retry-succeed', shouldFail: true },
      maxAttempts: 1,
    });

    // Process - it fails
    await processJobs(request);
    const { job: failedJob } = await getJob(request, id);
    expect(failedJob.status).toBe('failed');

    // Retry first (sets status to 'pending'), then edit payload + maxAttempts
    await retryJob(request, id);
    await editJob(request, id, {
      payload: { value: 'retry-succeed', shouldFail: false },
      maxAttempts: 2,
    });

    // Verify it's pending
    const { job: retriedJob } = await getJob(request, id);
    expect(retriedJob.status).toBe('pending');

    // Process again - should succeed now
    await processJobs(request);
    const { job: completedJob } = await getJob(request, id);
    expect(completedJob.status).toBe('completed');
  });
});
