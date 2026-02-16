import { test, expect } from '@playwright/test';
import {
  addCronSchedule,
  getCronSchedule,
  getCronScheduleByName,
  listCronSchedules,
  editCronSchedule,
  removeCronSchedule,
  pauseCronSchedule,
  resumeCronSchedule,
  enqueueDueCronJobs,
  cancelJob,
  getJob,
  forceNextRunAt,
} from './helpers';

test.describe('Cron Schedules', () => {
  // Clean up all cron schedules (and any jobs they created) after the suite
  // so leftover schedules don't auto-enqueue jobs that block subsequent suites.
  test.afterAll(async ({ request }) => {
    const { schedules } = await listCronSchedules(request);
    if (schedules) {
      for (const s of schedules) {
        // Cancel any pending/processing job spawned by this schedule
        if (s.lastJobId) {
          await cancelJob(request, s.lastJobId).catch(() => {});
        }
        await removeCronSchedule(request, s.id);
      }
    }
  });

  test('add and retrieve a cron schedule', async ({ request }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-cron-${Date.now()}`,
      cronExpression: '*/5 * * * *',
      jobType: 'fast-job',
      payload: { value: 'cron-test' },
    });
    expect(id).toBeGreaterThan(0);

    const { schedule } = await getCronSchedule(request, id);
    expect(schedule).toBeTruthy();
    expect(schedule.cronExpression).toBe('*/5 * * * *');
    expect(schedule.jobType).toBe('fast-job');
    expect(schedule.status).toBe('active');
    expect(schedule.allowOverlap).toBe(false);
  });

  test('retrieve cron schedule by name', async ({ request }) => {
    const name = `e2e-by-name-${Date.now()}`;
    const { id } = await addCronSchedule(request, {
      scheduleName: name,
      cronExpression: '0 * * * *',
      jobType: 'fast-job',
      payload: { value: 'name-lookup' },
    });

    const { schedule } = await getCronScheduleByName(request, name);
    expect(schedule).toBeTruthy();
    expect(schedule.id).toBe(id);
  });

  test('list cron schedules', async ({ request }) => {
    const name = `e2e-list-${Date.now()}`;
    await addCronSchedule(request, {
      scheduleName: name,
      cronExpression: '0 0 * * *',
      jobType: 'fast-job',
      payload: { value: 'list-test' },
    });

    const { schedules } = await listCronSchedules(request);
    expect(schedules.length).toBeGreaterThanOrEqual(1);
    const found = schedules.find((s) => s.scheduleName === name);
    expect(found).toBeTruthy();
  });

  test('list cron schedules filtered by status', async ({ request }) => {
    const name = `e2e-filter-${Date.now()}`;
    const { id } = await addCronSchedule(request, {
      scheduleName: name,
      cronExpression: '0 0 * * *',
      jobType: 'fast-job',
      payload: { value: 'filter-test' },
    });

    // Should appear in active list
    const { schedules: active } = await listCronSchedules(request, 'active');
    expect(active.find((s) => s.id === id)).toBeTruthy();

    // Pause and check paused list
    await pauseCronSchedule(request, id);
    const { schedules: paused } = await listCronSchedules(request, 'paused');
    expect(paused.find((s) => s.id === id)).toBeTruthy();

    // Should no longer appear in active list
    const { schedules: activeAfter } = await listCronSchedules(
      request,
      'active',
    );
    expect(activeAfter.find((s) => s.id === id)).toBeFalsy();
  });

  test('pause and resume a cron schedule', async ({ request }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-pause-${Date.now()}`,
      cronExpression: '0 0 * * *',
      jobType: 'fast-job',
      payload: { value: 'pause-test' },
    });

    await pauseCronSchedule(request, id);
    let { schedule } = await getCronSchedule(request, id);
    expect(schedule.status).toBe('paused');

    await resumeCronSchedule(request, id);
    ({ schedule } = await getCronSchedule(request, id));
    expect(schedule.status).toBe('active');
  });

  test('edit a cron schedule', async ({ request }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-edit-${Date.now()}`,
      cronExpression: '0 0 * * *',
      jobType: 'fast-job',
      payload: { value: 'edit-test' },
    });

    await editCronSchedule(request, id, {
      cronExpression: '*/10 * * * *',
      payload: { value: 'edited' },
    });

    const { schedule } = await getCronSchedule(request, id);
    expect(schedule.cronExpression).toBe('*/10 * * * *');
    expect(schedule.payload).toEqual({ value: 'edited' });
  });

  test('remove a cron schedule', async ({ request }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-remove-${Date.now()}`,
      cronExpression: '0 0 * * *',
      jobType: 'fast-job',
      payload: { value: 'remove-test' },
    });

    await removeCronSchedule(request, id);
    const { schedule } = await getCronSchedule(request, id);
    expect(schedule).toBeNull();
  });

  test('enqueueDueCronJobs creates job for due schedule', async ({
    request,
  }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-enqueue-${Date.now()}`,
      cronExpression: '* * * * *',
      jobType: 'fast-job',
      payload: { value: 'enqueue-test' },
    });

    // Force the schedule to be due right now
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );

    const { enqueued } = await enqueueDueCronJobs(request);
    expect(enqueued).toBeGreaterThanOrEqual(1);

    // Verify the schedule's lastJobId is set and points to a valid job
    const { schedule: after } = await getCronSchedule(request, id);
    expect(after.lastJobId).not.toBeNull();
    const { job } = await getJob(request, after.lastJobId);
    expect(job).toBeTruthy();
    expect(job.jobType).toBe('fast-job');
    expect(job.payload).toEqual({ value: 'enqueue-test' });
  });

  test('enqueueDueCronJobs skips paused schedules', async ({ request }) => {
    const { id } = await addCronSchedule(request, {
      scheduleName: `e2e-paused-skip-${Date.now()}`,
      cronExpression: '* * * * *',
      jobType: 'fast-job',
      payload: { value: 'paused-skip' },
    });

    // Force due and pause — paused schedules should never enqueue
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );
    await pauseCronSchedule(request, id);

    await enqueueDueCronJobs(request);

    // Verify no job was enqueued for this paused schedule
    const { schedule } = await getCronSchedule(request, id);
    expect(schedule.lastJobId).toBeNull();
  });

  test('overlap protection skips when previous job is still active', async ({
    request,
  }) => {
    const scheduleName = `e2e-overlap-${Date.now()}`;
    const { id } = await addCronSchedule(request, {
      scheduleName,
      cronExpression: '* * * * *',
      jobType: 'fast-job',
      payload: { value: 'overlap-test' },
      allowOverlap: false,
    });

    // Force the schedule to be due and enqueue the first job
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );
    await enqueueDueCronJobs(request);
    const { schedule: after1 } = await getCronSchedule(request, id);
    expect(after1.lastJobId).not.toBeNull();

    // The job is still "pending" (an active state for overlap protection).
    // Force the schedule due again and attempt a second enqueue.
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );
    await enqueueDueCronJobs(request);
    const { schedule: after2 } = await getCronSchedule(request, id);

    // lastJobId must not change — the pending job blocks a new enqueue
    expect(after2.lastJobId).toBe(after1.lastJobId);
  });

  test('allowOverlap: true creates new instance even when previous is active', async ({
    request,
  }) => {
    const scheduleName = `e2e-allow-overlap-${Date.now()}`;
    const { id } = await addCronSchedule(request, {
      scheduleName,
      cronExpression: '* * * * *',
      jobType: 'fast-job',
      payload: { value: 'allow-overlap' },
      allowOverlap: true,
    });

    // Force the schedule to be due and enqueue the first job
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );
    await enqueueDueCronJobs(request);
    const { schedule: after1 } = await getCronSchedule(request, id);
    const firstJobId = after1.lastJobId;
    expect(firstJobId).not.toBeNull();

    // Force due again — with allowOverlap=true a new job should be created
    await forceNextRunAt(
      request,
      id,
      new Date(Date.now() - 60_000).toISOString(),
    );
    await enqueueDueCronJobs(request);
    const { schedule: after2 } = await getCronSchedule(request, id);

    // A new job should have been created (different lastJobId)
    expect(after2.lastJobId).not.toBeNull();
    expect(after2.lastJobId).not.toBe(firstJobId);
  });
});
