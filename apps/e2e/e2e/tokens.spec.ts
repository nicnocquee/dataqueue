import { test, expect } from '@playwright/test';
import { createToken, getToken, completeToken, expireTokens } from './helpers';

test.describe('Tokens (Waitpoints)', () => {
  test('create, get, and complete a token', async ({ request }) => {
    // Create a token
    const { token } = await createToken(request, { timeout: '10m' });
    expect(token.id).toBeTruthy();

    // Get the token
    const { token: fetched } = await getToken(request, token.id);
    expect(fetched.status).toBe('waiting');

    // Complete the token
    await completeToken(request, token.id, { result: 'hello' });

    // Verify it's completed
    const { token: completed } = await getToken(request, token.id);
    expect(completed.status).toBe('completed');
    expect(completed.output).toEqual({ result: 'hello' });
  });

  test('create a token with tags', async ({ request }) => {
    const { token } = await createToken(request, {
      timeout: '5m',
      tags: ['test-tag-1', 'test-tag-2'],
    });

    const { token: fetched } = await getToken(request, token.id);
    expect(fetched.tags).toEqual(['test-tag-1', 'test-tag-2']);
  });

  test('expire timed-out tokens', async ({ request }) => {
    // Create a token with very short timeout
    const { token } = await createToken(request, { timeout: '1s' });
    expect(token.id).toBeTruthy();

    // Wait for it to expire
    await new Promise((r) => setTimeout(r, 2000));

    // Run expiry
    const { expired } = await expireTokens(request);
    expect(expired).toBeGreaterThanOrEqual(1);

    // Verify status
    const { token: expiredToken } = await getToken(request, token.id);
    expect(expiredToken.status).toBe('timed_out');
  });
});
