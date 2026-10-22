import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLaunch, listLaunches, readBrief, readJob } from '@/lib/launch/store';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-store-'));
});

describe('launch store', () => {
  it('creates a reel folder from the title, numbering a taken slug', async () => {
    const a = await createLaunch({ title: 'Gemini 4', links: ['https://blog.google/x'] }, new Date('2026-10-21T08:00:00Z'));
    const b = await createLaunch({ title: 'Gemini 4', links: ['https://blog.google/x'] }, new Date('2026-10-21T08:00:00Z'));
    expect([a, b]).toEqual(['gemini-4', 'gemini-4-2']);
    expect((await readBrief(a))?.createdAt).toBe('2026-10-21T08:00:00.000Z');
    expect((await readJob(a))?.stages.research.status).toBe('pending');
    expect((await listLaunches()).map((r) => r.slug).sort()).toEqual(['gemini-4', 'gemini-4-2']);
  });
});
