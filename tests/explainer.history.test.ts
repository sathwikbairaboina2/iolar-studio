import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'explainer-history-'));
  process.env.IOLAR_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.IOLAR_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

const doc = (title: string) => ({
  template: 'explainer' as const,
  theme: 'midnight',
  ratio: '9:16' as const,
  fps: 30 as const,
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: { title, subtitle: null, rows: [], links: [], note: null, panel: [] },
  beats: [
    { id: 'b1', role: 'hook' as const, sec: null, mutations: [] },
    { id: 'b2', role: 'payoff' as const, sec: null, mutations: [] },
  ],
});

const meta = (op: string) => ({ op, args: {}, actor: 'ui' as const, summary: op });

describe('explainer history', () => {
  it('records an entry and can undo back to the previous document', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('first'));

    await history.push('x', doc('first'), doc('second'), meta('scene.text'));
    await store.save('x', doc('second'));

    const back = await history.undo('x');
    expect(back.doc.scene.title).toBe('first');
    expect((await store.get('x'))!.scene.title).toBe('first');
  });

  it('redoes what it undid', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('first'));
    await history.push('x', doc('first'), doc('second'), meta('scene.text'));
    await history.undo('x');

    const forward = await history.redo('x');
    expect(forward.doc.scene.title).toBe('second');
  });

  it('refuses to undo past the beginning', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('only'));
    await expect(history.undo('x')).rejects.toThrow(/nothing to undo/);
  });

  it('abandons the redo tail when a command follows an undo', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('a'));
    await history.push('x', doc('a'), doc('b'), meta('one'));
    await history.undo('x');
    const log = await history.push('x', doc('a'), doc('c'), meta('two'));
    expect(log.entries.map((e) => e.op)).toEqual(['two']);
    expect(log.cursor).toBe(1);
  });

  it('keeps the log self-consistent past the limit', async () => {
    const history = await import('@/lib/explainer/history');
    const store = await import('@/lib/explainer/store');
    await store.save('x', doc('0'));
    for (let i = 1; i <= history.HISTORY_LIMIT + 5; i += 1) {
      await history.push('x', doc(String(i - 1)), doc(String(i)), meta(`edit-${i}`));
    }
    const log = await history.read('x');
    expect(log.entries).toHaveLength(history.HISTORY_LIMIT);

    // The base still names a snapshot that exists: undoing all the way back must work.
    for (let i = 0; i < history.HISTORY_LIMIT; i += 1) await history.undo('x');
    const floor = await store.get('x');
    expect(floor).not.toBeNull();
    await expect(history.undo('x')).rejects.toThrow(/nothing to undo/);
  });
});
