import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-camp-'));
});

describe('campaign state', () => {
  it('starts empty and reports nothing done', async () => {
    const { loadState, isDone } = await import('@/lib/verify/campaignState');
    const s = await loadState();
    expect(isDone(s, 'python/decorators/1', 'polish')).toBe(false);
  });

  it('remembers a completed stage across a reload', async () => {
    const { loadState, isDone, markDone, stateFile } = await import('@/lib/verify/campaignState');
    const s = await loadState();
    await markDone(s, 'python/decorators/1', 'polish');
    expect(existsSync(stateFile())).toBe(true);

    const again = await loadState();
    expect(isDone(again, 'python/decorators/1', 'polish')).toBe(true);
    expect(isDone(again, 'python/decorators/1', 'review')).toBe(false);
    expect(isDone(again, 'python/decorators/2', 'polish')).toBe(false);
  });

  it('survives a corrupt state file rather than losing the run', async () => {
    const { stateFile, loadState, isDone } = await import('@/lib/verify/campaignState');
    const { promises: fs } = await import('fs');
    await fs.mkdir(path.dirname(stateFile()), { recursive: true });
    await fs.writeFile(stateFile(), '{ not json');
    const s = await loadState();
    expect(isDone(s, 'anything', 'polish')).toBe(false);
  });
});
