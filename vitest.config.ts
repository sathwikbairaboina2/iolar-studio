import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The suite runs Chromium page renders and sandboxed Python alongside the component
    // tests. Left unbounded they saturate every core and starve the jsdom suites into
    // spurious timeouts, so cap the workers and give a starved test room to finish.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
