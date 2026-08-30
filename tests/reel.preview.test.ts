import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The dry run an agent proposes through. Its whole job is to answer "what would
 * this do?" without doing any of it — so the guarantee under test is mostly
 * about what does NOT happen.
 */

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-preview-'));
  (await import('@/lib/reel/bus')).resetBus();
});

const clip = (id: string, assetId: string, start: number, end: number) => ({
  id,
  assetId,
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] },
  transition: 'cut' as const,
  locked: false,
});

async function seed() {
  const { validateReel, emptyReel } = await import('@/lib/reel/schema');
  const { saveReel } = await import('@/lib/reel/store');
  const reel = validateReel({
    ...emptyReel('grok'),
    title: 'Grok',
    vo: { durationSec: 12 },
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a1', 4, 9)],
      captions: [{ id: 'k1', text: 'hello there', start: 0.5, end: 1.4 }],
      overlays: [],
    },
  });
  await saveReel('grok', reel);
  return reel;
}

describe('previewCommands', () => {
  it('projects what the commands would produce', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' },
      { op: 'caption.edit', args: { cueId: 'k1', text: 'rewritten' }, actor: 'agent' },
    ]);

    expect(out.reel.timeline.clips[0].fit).toBe('contain');
    expect(out.reel.timeline.captions[0].text).toBe('rewritten');
    expect(out.rejected).toEqual([]);
  });

  it('folds each command onto the result of the one before it', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.split', args: { clipId: 'c1', atSec: 2 }, actor: 'agent' },
      { op: 'clip.fit', args: { clipId: 'c1-b', fit: 'contain' }, actor: 'agent' },
    ]);

    // c1-b exists only because the split ran first.
    expect(out.rejected).toEqual([]);
    expect(out.reel.timeline.clips.find((c) => c.id === 'c1-b')?.fit).toBe('contain');
  });

  it('leaves the reel on disk untouched', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const { loadReel } = await import('@/lib/reel/store');
    const before = await seed();

    await previewCommands('grok', [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' }]);

    expect(await loadReel('grok')).toEqual(before);
  });

  it('writes nothing to history', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const history = await import('@/lib/reel/history');
    await seed();

    await previewCommands('grok', [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' }]);

    expect(await history.read('grok')).toEqual({ cursor: 0, entries: [] });
  });

  it('publishes nothing, so open tabs do not flicker through a proposal', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const { subscribe } = await import('@/lib/reel/bus');
    await seed();
    const seen: unknown[] = [];
    subscribe('grok', (r) => seen.push(r));

    await previewCommands('grok', [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' }]);

    expect(seen).toEqual([]);
  });

  it('summarises what applied, in order', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' },
      { op: 'caption.toggle', args: { cueId: 'k1' }, actor: 'agent' },
    ]);

    expect(out.applied.map((a) => a.op)).toEqual(['clip.fit', 'caption.toggle']);
    expect(out.applied[0].summary).toMatch(/c1/);
  });

  it('reports a rejection with the reason and the index that failed', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.delete', args: { clipId: 'c99' }, actor: 'agent' },
    ]);

    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ index: 0, op: 'clip.delete' });
    expect(out.rejected[0].error).toMatch(/c99/);
    expect(out.rejected[0].detail).toMatchObject({ validIds: ['c1', 'c2'] });
  });

  // Preview is diagnostic: an agent on a revision budget should learn every problem at once.
  it('keeps going after a rejection so one bad command does not mask the rest', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.delete', args: { clipId: 'c99' }, actor: 'agent' },
      { op: 'caption.nudge', args: { cueId: 'k404' }, actor: 'agent' },
      { op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' },
    ]);

    expect(out.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(out.applied.map((a) => a.op)).toEqual(['clip.fit']);
  });

  it('projects only the commands that applied', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.delete', args: { clipId: 'c99' }, actor: 'agent' },
      { op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'agent' },
    ]);

    expect(out.reel.timeline.clips).toHaveLength(2);
    expect(out.reel.timeline.clips[0].fit).toBe('contain');
  });

  it('rejects an unknown op the same way the real command path does', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [{ op: 'clip.explode', args: {}, actor: 'agent' }]);

    expect(out.rejected[0].detail).toMatchObject({ validOps: expect.arrayContaining(['clip.trim']) });
  });

  it('rejects malformed args and hands back the schema they failed', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'clip.trim', args: { clipId: 'c1' }, actor: 'agent' },
    ]);

    expect(out.rejected).toHaveLength(1);
    expect((out.rejected[0].detail as { schema?: unknown }).schema).toBeDefined();
  });

  it('reports a missing reel rather than projecting an empty one', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');

    await expect(previewCommands('no-such-reel', [])).rejects.toThrow(/no reel/i);
  });

  it('returns the reel unchanged for an empty command list', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const before = await seed();

    const out = await previewCommands('grok', []);

    expect(out.reel).toEqual(before);
    expect(out.applied).toEqual([]);
    expect(out.rejected).toEqual([]);
  });
});
