import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Snapshot-per-command, because reels are small JSON and undo is then trivially
 * correct: no per-op inverse to get wrong.
 */

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-history-'));
});

async function seed(title = 'base') {
  const { emptyReel } = await import('@/lib/reel/schema');
  const { saveReel } = await import('@/lib/reel/store');
  const reel = { ...emptyReel('grok'), title };
  await saveReel('grok', reel);
  return reel;
}

const entry = (op: string, actor: 'ui' | 'agent' = 'ui') => ({
  op,
  args: {},
  actor,
  summary: op,
});

describe('reel history', () => {
  it('records the op, actor and summary that produced a state', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed();

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.split', 'agent'));
    const log = await h.read('grok');

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ op: 'clip.split', actor: 'agent', summary: 'clip.split' });
    expect(log.entries[0].at).toBeTypeOf('string');
  });

  it('restores the previous reel on undo', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed('base');

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));
    await h.push('grok', base, { ...base, title: 'two' }, entry('clip.delete'));
    const back = await h.undo('grok');

    expect(back.reel.title).toBe('one');
  });

  it('undoes back to the state the reel had before the first command', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed('base');

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));
    await h.undo('grok');

    const log = await h.read('grok');
    expect(log.cursor).toBe(0);
    const restored = await import('@/lib/reel/store').then((s) => s.loadReel('grok'));
    expect(restored.title).toBe('base');
  });

  it('replays forward on redo', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed('base');

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));
    await h.push('grok', base, { ...base, title: 'two' }, entry('clip.delete'));
    await h.undo('grok');
    const forward = await h.redo('grok');

    expect(forward.reel.title).toBe('two');
  });

  it('writes the restored reel back to disk so undo is durable', async () => {
    const h = await import('@/lib/reel/history');
    const { loadReel } = await import('@/lib/reel/store');
    const base = await seed('base');

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));
    await h.push('grok', base, { ...base, title: 'two' }, entry('clip.delete'));
    await h.undo('grok');

    expect((await loadReel('grok')).title).toBe('one');
  });

  it('truncates the redo tail when a new command lands after an undo', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed('base');

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));
    await h.push('grok', base, { ...base, title: 'two' }, entry('clip.delete'));
    await h.undo('grok');
    await h.push('grok', base, { ...base, title: 'branch' }, entry('clip.move'));

    const log = await h.read('grok');
    expect(log.entries.map((e) => e.op)).toEqual(['clip.trim', 'clip.move']);
    await expect(h.redo('grok')).rejects.toThrow(/redo/i);
  });

  it('refuses to undo past the beginning', async () => {
    const h = await import('@/lib/reel/history');
    await seed();

    await expect(h.undo('grok')).rejects.toThrow(/undo/i);
  });

  it('refuses to redo at the tail', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed();

    await h.push('grok', base, { ...base, title: 'one' }, entry('clip.trim'));

    await expect(h.redo('grok')).rejects.toThrow(/redo/i);
  });

  it('caps the log, dropping the oldest entries', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed();

    for (let i = 0; i < h.HISTORY_LIMIT + 5; i++) {
      await h.push('grok', base, { ...base, title: `t${i}` }, entry(`op${i}`));
    }
    const log = await h.read('grok');

    expect(log.entries).toHaveLength(h.HISTORY_LIMIT);
    expect(log.entries[0].op).toBe('op5');
    expect(log.cursor).toBe(h.HISTORY_LIMIT);
  });

  it('still undoes correctly after pruning', async () => {
    const h = await import('@/lib/reel/history');
    const base = await seed();

    for (let i = 0; i < h.HISTORY_LIMIT + 5; i++) {
      await h.push('grok', base, { ...base, title: `t${i}` }, entry(`op${i}`));
    }
    const back = await h.undo('grok');

    expect(back.reel.title).toBe(`t${h.HISTORY_LIMIT + 3}`);
  });

  it('reports an empty log for a reel nothing has edited yet', async () => {
    const h = await import('@/lib/reel/history');
    await seed();

    const log = await h.read('grok');

    expect(log).toEqual({ cursor: 0, entries: [] });
  });
});
