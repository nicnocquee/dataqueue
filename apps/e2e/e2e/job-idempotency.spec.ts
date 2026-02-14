import { test, expect } from '@playwright/test';
import { addJob } from './helpers';

test.describe('Job Idempotency', () => {
  test('duplicate idempotency key returns same job id', async ({ request }) => {
    const uniqueKey = `idemp-${Date.now()}-${Math.random()}`;

    const { id: firstId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'idempotent-1' },
      idempotencyKey: uniqueKey,
    });

    const { id: secondId } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'idempotent-2' },
      idempotencyKey: uniqueKey,
    });

    expect(firstId).toBe(secondId);
  });

  test('different idempotency keys create different jobs', async ({
    request,
  }) => {
    const { id: id1 } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'unique-1' },
      idempotencyKey: `unique-${Date.now()}-a`,
    });

    const { id: id2 } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'unique-2' },
      idempotencyKey: `unique-${Date.now()}-b`,
    });

    expect(id1).not.toBe(id2);
  });
});
