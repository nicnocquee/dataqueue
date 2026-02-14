import { test, expect } from '@playwright/test';
import { addJob, getJobs } from './helpers';

test.describe('Job Tags', () => {
  const uniquePrefix = `tag-test-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // Create jobs with various tag combinations
    await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'a' },
      tags: [`${uniquePrefix}-alpha`, `${uniquePrefix}-beta`],
    });
    await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'b' },
      tags: [`${uniquePrefix}-alpha`, `${uniquePrefix}-gamma`],
    });
    await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'c' },
      tags: [`${uniquePrefix}-beta`, `${uniquePrefix}-gamma`],
    });
    await addJob(request, {
      jobType: 'fast-job',
      payload: { value: 'd' },
      tags: [`${uniquePrefix}-alpha`],
    });
  });

  test('query tags with "any" mode', async ({ request }) => {
    const { jobs } = await getJobs(request, {
      tags: `${uniquePrefix}-alpha`,
      tagMode: 'any',
    });
    // Jobs a, b, d have alpha
    const values = jobs.map((j: any) => j.payload.value);
    expect(values).toContain('a');
    expect(values).toContain('b');
    expect(values).toContain('d');
  });

  test('query tags with "all" mode', async ({ request }) => {
    const { jobs } = await getJobs(request, {
      tags: `${uniquePrefix}-alpha,${uniquePrefix}-beta`,
      tagMode: 'all',
    });
    // Only job a has both alpha and beta
    const values = jobs.map((j: any) => j.payload.value);
    expect(values).toContain('a');
    expect(values).not.toContain('b');
    expect(values).not.toContain('c');
  });

  test('query tags with "exact" mode', async ({ request }) => {
    const { jobs } = await getJobs(request, {
      tags: `${uniquePrefix}-alpha`,
      tagMode: 'exact',
    });
    // Only job d has exactly [alpha]
    const values = jobs.map((j: any) => j.payload.value);
    expect(values).toContain('d');
    expect(values).not.toContain('a'); // a has alpha + beta
  });

  test('query tags with "none" mode', async ({ request }) => {
    const { jobs } = await getJobs(request, {
      tags: `${uniquePrefix}-alpha`,
      tagMode: 'none',
    });
    // Job c has only beta + gamma (no alpha)
    const values = jobs.map((j: any) => j.payload.value);
    expect(values).toContain('c');
    expect(values).not.toContain('a');
    expect(values).not.toContain('b');
    expect(values).not.toContain('d');
  });
});
