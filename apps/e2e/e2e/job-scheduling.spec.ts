import { test, expect } from '@playwright/test';
import { addJob, getJob, processJobs, editJob } from './helpers';

test.describe('Job Scheduling', () => {
  test('job with future runAt is not processed', async ({ request }) => {
    // Schedule 1 hour in the future
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'future-job' },
      runAt: futureDate,
    });

    // Process - should not pick it up
    await processJobs(request);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('pending');
  });

  test('job with past runAt is processed', async ({ request }) => {
    // Schedule in the past
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'past-job' },
      runAt: pastDate,
    });

    await processJobs(request);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('completed');
  });

  test('edit runAt from future to past and process', async ({ request }) => {
    // Schedule far in the future
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'reschedule-test' },
      runAt: futureDate,
    });

    // Won't be processed
    await processJobs(request);
    let { job } = await getJob(request, id);
    expect(job.status).toBe('pending');

    // Edit to past
    const pastDate = new Date(Date.now() - 1000).toISOString();
    await editJob(request, id, { runAt: pastDate });

    // Now it should process
    await processJobs(request);
    ({ job } = await getJob(request, id));
    expect(job.status).toBe('completed');
  });
});
