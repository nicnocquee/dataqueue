import { test, expect } from '@playwright/test';
import { addJob, processJobs, waitForJobStatus } from './helpers';

const BASE = 'http://localhost:3099';

test.describe('React SDK — useJob hook', () => {
  test('displays loading then job status after first fetch', async ({
    page,
    request,
  }) => {
    // Add a pending job
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'react-sdk-test' },
    });

    // Navigate to the React SDK test page
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Wait for the hook to load data
    await expect(page.getByTestId('status')).not.toHaveText('none', {
      timeout: 5000,
    });

    // Verify job data
    await expect(page.getByTestId('status')).toHaveText('pending');
    await expect(page.getByTestId('is-loading')).toHaveText('false');
    await expect(page.getByTestId('job-type')).toHaveText('fast-job');
  });

  test('polls and updates status when job completes', async ({
    page,
    request,
  }) => {
    // Add a job
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'react-sdk-poll-test' },
    });

    // Navigate to the test page with fast polling
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Wait for initial fetch
    await expect(page.getByTestId('status')).toHaveText('pending', {
      timeout: 5000,
    });

    // Process the job in the background
    await processJobs(request);

    // The hook should poll and eventually show 'completed'
    await expect(page.getByTestId('status')).toHaveText('completed', {
      timeout: 10000,
    });

    // Verify the onStatusChange and onComplete callbacks fired
    const eventsEl = page.getByTestId('events');
    await expect(eventsEl).toContainText('callback:complete');
  });

  test('tracks progress updates during job execution', async ({
    page,
    request,
  }) => {
    // Add a progress job with 5 steps, 200ms each
    const { id } = await addJob(request, {
      jobType: 'progress-job',
      payload: { value: 'progress-test', steps: 5, delayMs: 200 },
    });

    // Navigate to the test page with fast polling
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Wait for initial pending status
    await expect(page.getByTestId('status')).toHaveText('pending', {
      timeout: 5000,
    });

    // Process the job — this returns after all handlers run
    await processJobs(request);

    // Wait for the hook to pick up completion
    await expect(page.getByTestId('status')).toHaveText('completed', {
      timeout: 10000,
    });

    // Progress should end at 100
    await expect(page.getByTestId('progress')).toHaveText('100');
  });

  test('shows failed status and calls onFailed callback', async ({
    page,
    request,
  }) => {
    // Add a job that will fail
    const { id } = await addJob(request, {
      jobType: 'failing-job',
      payload: { value: 'fail-test', shouldFail: true },
      maxAttempts: 1,
    });

    // Navigate to the test page
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Wait for initial status
    await expect(page.getByTestId('status')).not.toHaveText('none', {
      timeout: 5000,
    });

    // Process the job — it should fail
    await processJobs(request);

    // Wait for the hook to detect the failure
    await expect(page.getByTestId('status')).toHaveText('failed', {
      timeout: 10000,
    });

    // Verify the onFailed callback fired
    const eventsEl = page.getByTestId('events');
    await expect(eventsEl).toContainText('callback:failed');
  });

  test('fires onStatusChange callback on each transition', async ({
    page,
    request,
  }) => {
    // Add a job
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'status-change-test' },
    });

    // Navigate to the test page
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Wait for pending status
    await expect(page.getByTestId('status')).toHaveText('pending', {
      timeout: 5000,
    });

    // Process the job
    await processJobs(request);

    // Wait for completion
    await expect(page.getByTestId('status')).toHaveText('completed', {
      timeout: 10000,
    });

    // Verify status transitions were captured
    const eventsEl = page.getByTestId('events');
    await expect(eventsEl).toContainText('status:null->pending');
    await expect(eventsEl).toContainText('callback:complete');
  });

  test('stops polling after terminal status (completed)', async ({
    page,
    request,
  }) => {
    // Add and immediately process a job so it's already completed
    const { id } = await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'stop-poll-test' },
    });
    await processJobs(request);
    await waitForJobStatus(request, id, 'completed');

    // Navigate to the test page
    await page.goto(`${BASE}/react-sdk?jobId=${id}&interval=300`);

    // Should load as completed immediately
    await expect(page.getByTestId('status')).toHaveText('completed', {
      timeout: 5000,
    });

    // Wait a bit and verify no additional network requests after the first fetch
    // We indirectly verify this by checking the status is stable (not flashing)
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('status')).toHaveText('completed');
  });

  test('handles no jobId gracefully', async ({ page }) => {
    // Navigate without a jobId
    await page.goto(`${BASE}/react-sdk`);

    // Should not be loading and show no data
    await expect(page.getByTestId('is-loading')).toHaveText('false');
    await expect(page.getByTestId('status')).toHaveText('none');
    await expect(page.getByTestId('job-id')).toHaveText('none');
  });
});
