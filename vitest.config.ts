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
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
