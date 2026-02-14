import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Sequential to avoid DB conflicts
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3099',
  },
  webServer: {
    command: 'pnpm next dev --turbopack --port 3099',
    port: 3099,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PG_DATAQUEUE_DATABASE:
        process.env.PG_DATAQUEUE_DATABASE ||
        'postgres://postgres:postgres@localhost:5432/e2e_test',
    },
  },
});
