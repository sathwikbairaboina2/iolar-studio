import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-aiiolar-'));
  delete process.env.AIIOLAR_JOBS_URL;
});
afterEach(() => {
  delete process.env.AIIOLAR_JOBS_URL;
});

describe('the aiiolar jobs page setting', () => {
  it('defaults to the public jobs page', async () => {
    const { getSettings } = await import('@/lib/settings');
    expect(getSettings().aiiolarJobsUrl).toBe('https://aiiolar.com/jobs');
  });

  it('reads the saved value, and AIIOLAR_JOBS_URL beats it', async () => {
    const { getSettings, saveSettings } = await import('@/lib/settings');
    saveSettings({ aiiolarJobsUrl: 'https://staging.aiiolar.test/jobs' });
    expect(getSettings().aiiolarJobsUrl).toBe('https://staging.aiiolar.test/jobs');
    process.env.AIIOLAR_JOBS_URL = 'http://127.0.0.1:9/jobs';
    expect(getSettings().aiiolarJobsUrl).toBe('http://127.0.0.1:9/jobs');
  });

  it('never writes the environment override into the settings file', async () => {
    const { saveSettings } = await import('@/lib/settings');
    process.env.AIIOLAR_JOBS_URL = 'http://127.0.0.1:9/jobs';
    saveSettings({ brand: 'x' });
    const file = JSON.parse(readFileSync(path.join(process.env.IOLAR_DATA_DIR!, 'settings.json'), 'utf8'));
    expect(file.aiiolarJobsUrl).toBe('https://aiiolar.com/jobs');
  });

  it('ignores an empty override', async () => {
    const { getSettings } = await import('@/lib/settings');
    process.env.AIIOLAR_JOBS_URL = '  ';
    expect(getSettings().aiiolarJobsUrl).toBe('https://aiiolar.com/jobs');
  });
});
