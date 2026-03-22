import { test, expect } from '@playwright/test';
import { addJob, addJobsBatch, getJob, processJobs } from './helpers';

test.describe('Job dependencies', () => {
  test('dependent with dependsOn.jobIds runs only after prerequisite completes', async ({
    request,
  }) => {
    const { id: prereqId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'dep-prereq' },
    });
    const { id: depId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'dep-follow' },
      dependsOn: { jobIds: [prereqId] },
    });

    await processJobs(request);
    const { job: afterFirst } = await getJob(request, depId);
    expect(afterFirst.status).toBe('pending');

    const { job: prereqAfter } = await getJob(request, prereqId);
    expect(prereqAfter.status).toBe('completed');

    await processJobs(request);
    const { job: depDone } = await getJob(request, depId);
    expect(depDone.status).toBe('completed');
  });

  test('dependsOn.tags: dependent waits until tagged barrier job finishes', async ({
    request,
  }) => {
    await addJob(request, {
      jobType: 'slow-job',
      payload: { value: 'barrier', delayMs: 250 },
      tags: ['e2e-barrier'],
    });
    const { id: depId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'after-barrier' },
      dependsOn: { tags: ['e2e-barrier'] },
    });

    await processJobs(request);
    const { job: depAfterBarrier } = await getJob(request, depId);
    expect(depAfterBarrier.status).toBe('pending');

    await processJobs(request);
    const { job: depDone } = await getJob(request, depId);
    expect(depDone.status).toBe('completed');
  });

  test('addJobs batch resolves batch-relative dependsOn.jobIds', async ({
    request,
  }) => {
    const { ids } = await addJobsBatch(request, [
      { jobType: 'fast-job', payload: { value: 'batch-a' } },
      {
        jobType: 'fast-job',
        payload: { value: 'batch-b' },
        dependsOn: { jobIds: [-1] },
      },
    ]);
    expect(ids).toHaveLength(2);

    const { job: first } = await getJob(request, ids[0]!);
    const { job: second } = await getJob(request, ids[1]!);
    expect(second.dependsOnJobIds).toEqual([first.id]);

    await processJobs(request);
    const { job: aAfter } = await getJob(request, ids[0]!);
    const { job: bAfter } = await getJob(request, ids[1]!);
    expect(aAfter.status).toBe('completed');
    expect(bAfter.status).toBe('pending');

    await processJobs(request);
    const { job: bDone } = await getJob(request, ids[1]!);
    expect(bDone.status).toBe('completed');
  });

  test('failed prerequisite cancels pending dependent', async ({ request }) => {
    const { id: prereqId } = await addJob(request, {
      jobType: 'failing-job',
      payload: { value: 'dep-root-fail', shouldFail: true },
      maxAttempts: 1,
    });
    const { id: depId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'dep-cancelled' },
      dependsOn: { jobIds: [prereqId] },
    });

    await processJobs(request);

    const { job: prereq } = await getJob(request, prereqId);
    const { job: dep } = await getJob(request, depId);
    expect(prereq.status).toBe('failed');
    expect(dep.status).toBe('cancelled');
  });
});
