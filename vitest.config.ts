import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The reel suite runs real ffmpeg encodes and Playwright renders alongside the fast
    // component tests; 5s is not enough headroom for those to share a machine.
    // Chromium page renders and sandboxed Python now share the machine with the jsdom
    // suites; left unbounded they saturate every core and starve a test into a spurious
    // timeout, so cap the workers and give a starved test room to finish.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
    // Nested worktrees under .claude/ carry their own copy of the suite; vitest must not run it here.
    exclude: ['**/node_modules/**', '**/.claude/**'],
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
