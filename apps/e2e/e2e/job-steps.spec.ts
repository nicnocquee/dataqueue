import { test, expect } from '@playwright/test';
import { addJob, getJob, processJobs } from './helpers';

test.describe('Job Steps (ctx.run)', () => {
  test('step job records step data', async ({ request }) => {
    const { id } = await addJob(request, {
      jobType: 'step-job',
      payload: { value: 'step-test', steps: ['step-a', 'step-b', 'step-c'] },
    });

    await processJobs(request);

    const { job } = await getJob(request, id);
    expect(job.status).toBe('completed');

    // stepData should contain results for each step
    if (job.stepData) {
      expect(job.stepData['step-a']).toBe('completed-step-a');
      expect(job.stepData['step-b']).toBe('completed-step-b');
      expect(job.stepData['step-c']).toBe('completed-step-c');
    }
  });
});
