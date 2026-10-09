import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pub-')); mkdirSync(path.join(process.env.IOLAR_DATA_DIR, 'handbooks', 's'), { recursive: true }); });

describe('publish state', () => {
  it('starts empty and round-trips', async () => {
    const { readState, writeState } = await import('@/lib/publish/state');
    expect(await readState('s')).toEqual({ alwaysAsk: false, chapters: {} });
    await writeState('s', { alwaysAsk: true, chapters: { a: { selected: true } } });
    expect((await readState('s')).alwaysAsk).toBe(true);
  });
  it('lists live chapters and the queue', async () => {
    const { liveChapters, queue } = await import('@/lib/publish/state');
    const s = { alwaysAsk: false, chapters: {
      a: { selected: true, verdict: 'pass' as const, approvedBy: 'ai' as const },
      b: { selected: true, verdict: 'unsure' as const },
      c: { selected: true, verdict: 'unsure' as const, approvedBy: 'human' as const },
      d: { selected: false, verdict: 'pass' as const, approvedBy: 'ai' as const },
      e: { selected: true, verdict: 'fail' as const },
      f: { selected: true, verdict: 'pass' as const, approvedBy: 'ai' as const, rejected: true },
      g: { selected: true, verdict: 'fail' as const, approvedBy: 'human' as const },
    } };
    expect(liveChapters(s).sort()).toEqual(['a', 'c']);
    expect(queue(s).chapters).toEqual(['b']);
  });
  it('queues a passing chapter nobody approved', async () => {
    const { queue } = await import('@/lib/publish/state');
    expect(queue({ alwaysAsk: true, chapters: { a: { selected: true, verdict: 'pass' } } }).chapters).toEqual(['a']);
  });
  it('queues an order that nobody approved', async () => {
    const { queue } = await import('@/lib/publish/state');
    const order = { order: ['a'], prerequisites: {}, gaps: [], overlaps: [], confidence: 0.5, basis: '' };
    expect(queue({ alwaysAsk: false, chapters: {}, order }).order).toBe(true);
    expect(queue({ alwaysAsk: false, chapters: {}, order: { ...order, approvedBy: 'ai' } }).order).toBe(false);
  });
});
