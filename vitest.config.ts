import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The reel suite runs real ffmpeg encodes and Playwright renders alongside the fast
    // component tests; 5s is not enough headroom for those to share a machine.
    testTimeout: 20_000,
    setupFiles: ['./tests/setup.ts'],
    // Nested worktrees under .claude/ carry their own copy of the suite; vitest must not run it here.
    exclude: ['**/node_modules/**', '**/.claude/**'],
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
