import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The suite runs Chromium renders and sandboxed Python alongside the component
    // tests, so a starved jsdom test can exceed the 5s default while being fast itself.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
