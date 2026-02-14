import { test, expect } from '@playwright/test';
import { addJob, getJob, processJobs, getJobEvents } from './helpers';

test.describe('Job Lifecycle', () => {
  test('add a job, process it, verify completed with events', async ({
    request,
  }) => {
    // Add a fast job
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'lifecycle-test' },
    });
    expect(id).toBeGreaterThan(0);

    // Verify it's pending
    const { job: pendingJob } = await getJob(request, id);
    expect(pendingJob.status).toBe('pending');
    expect(pendingJob.jobType).toBe('fast-job');
    expect(pendingJob.payload).toEqual({ value: 'lifecycle-test' });

    // Process jobs
    const { processed } = await processJobs(request);
    expect(processed).toBeGreaterThanOrEqual(1);

    // Verify it's completed
    const { job: completedJob } = await getJob(request, id);
    expect(completedJob.status).toBe('completed');

    // Check events trail
    const { events } = await getJobEvents(request, id);
    const eventTypes = events.map((e: any) => e.eventType);
    expect(eventTypes).toContain('added');
    expect(eventTypes).toContain('processing');
    expect(eventTypes).toContain('completed');
  });

  test('add multiple jobs and process them all', async ({ request }) => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { id } = await addJob(request, {
        jobType: 'fast-job',
        payload: { value: `multi-${i}` },
      });
      ids.push(id);
    }

    // Process all
    await processJobs(request, { batchSize: 10 });

    // Verify all completed
    for (const id of ids) {
      const { job } = await getJob(request, id);
      expect(job.status).toBe('completed');
    }
  });

  test('query jobs by status', async ({ request }) => {
    // Add a job but don't process it
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'status-query-test' },
    });

    // Query pending jobs
    const { jobs } = await (
      await request.get('http://localhost:3099/api/jobs?status=pending')
    ).json();
    const found = jobs.find((j: any) => j.id === id);
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');

    // Process and verify it shows in completed
    await processJobs(request);
    const { jobs: completedJobs } = await (
      await request.get('http://localhost:3099/api/jobs?status=completed')
    ).json();
    const completedFound = completedJobs.find((j: any) => j.id === id);
    expect(completedFound).toBeDefined();
  });
});
