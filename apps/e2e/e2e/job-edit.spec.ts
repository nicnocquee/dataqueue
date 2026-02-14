import { test, expect } from '@playwright/test';
import { addJob, getJob, editJob, bulkEdit } from './helpers';

test.describe('Job Edit', () => {
  test('edit a pending job payload', async ({ request }) => {
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'original' },
    });

    await editJob(request, id, {
      payload: { value: 'updated' },
    });

    const { job } = await getJob(request, id);
    expect(job.payload).toEqual({ value: 'updated' });
  });

  test('edit a pending job priority and tags', async ({ request }) => {
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'edit-priority' },
      priority: 1,
      tags: ['original-tag'],
    });

    await editJob(request, id, {
      priority: 10,
      tags: ['new-tag-1', 'new-tag-2'],
    });

    const { job } = await getJob(request, id);
    expect(job.priority).toBe(10);
    expect(job.tags).toEqual(['new-tag-1', 'new-tag-2']);
  });

  test('bulk edit pending jobs by job type', async ({ request }) => {
    const uniqueTag = `bulk-edit-${Date.now()}`;

    // Add several jobs
    for (let i = 0; i < 3; i++) {
      await addJob(request, {
        jobType: 'fast-job',
        payload: { value: `bulk-edit-${i}` },
        priority: 1,
        tags: [uniqueTag],
      });
    }

    // Bulk edit: update priority for all pending fast-jobs with this tag
    const { updated } = await bulkEdit(
      request,
      { tags: { values: [uniqueTag], mode: 'all' } },
      { priority: 99 },
    );
    expect(updated).toBeGreaterThanOrEqual(3);
  });
});
