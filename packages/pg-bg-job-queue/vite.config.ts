import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: './src/main.tsx',
      name: '@nicnocquee/use-local-storage-hook',
    },
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: '',
    types: ['vitest/globals'],
  },
} as UserConfig);
