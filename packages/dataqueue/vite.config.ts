import { defineConfig, type UserConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
} as UserConfig);
