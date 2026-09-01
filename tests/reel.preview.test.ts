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
    beats: [
      { id: 'b1', role: 'hook', text: 'the first line', shot: { kind: 'talking-head', brief: '' } },
      { id: 'b2', role: 'close', text: 'the second line', shot: { kind: 'talking-head', brief: '' } },
    ],
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' }],
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
      { op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten first line' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b2', text: 'a rewritten second line' }, actor: 'agent' },
    ]);

    expect(out.reel.beats[0].text).toBe('a rewritten first line');
    expect(out.reel.beats[1].text).toBe('a rewritten second line');
    expect(out.rejected).toEqual([]);
  });

  it('folds each command onto the result of the one before it', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b2', text: 'the second line rewritten again' }, actor: 'agent' },
    ]);

    // The second rewrite lands on the reel the first one produced.
    expect(out.rejected).toEqual([]);
    expect(out.reel.beats.map((b) => b.text)).toEqual(['a rewritten line', 'the second line rewritten again']);
  });

  it('leaves the reel on disk untouched', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const { loadReel } = await import('@/lib/reel/store');
    const before = await seed();

    await previewCommands('grok', [{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);

    expect(await loadReel('grok')).toEqual(before);
  });

  it('writes nothing to history', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const history = await import('@/lib/reel/history');
    await seed();

    await previewCommands('grok', [{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);

    expect(await history.read('grok')).toEqual({ cursor: 0, entries: [] });
  });

  it('publishes nothing, so open tabs do not flicker through a proposal', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    const { subscribe } = await import('@/lib/reel/bus');
    await seed();
    const seen: unknown[] = [];
    subscribe('grok', (r) => seen.push(r));

    await previewCommands('grok', [{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);

    expect(seen).toEqual([]);
  });

  it('summarises what applied, in order', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b2', text: 'another rewritten line' }, actor: 'agent' },
    ]);

    expect(out.applied.map((a) => a.op)).toEqual(['beat.text', 'beat.text']);
    expect(out.applied[0].summary).toMatch(/b1/);
  });

  it('reports a rejection with the reason and the index that failed', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b404', text: 'a line for a beat that is not there' }, actor: 'agent' },
    ]);

    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ index: 0, op: 'beat.text' });
    expect(out.rejected[0].error).toMatch(/b404/);
  });

  // Preview is diagnostic: an agent on a revision budget should learn every problem at once.
  it('keeps going after a rejection so one bad command does not mask the rest', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b404', text: 'a line for a beat that is not there' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b999', text: 'another missing beat' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' },
    ]);

    expect(out.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(out.applied.map((a) => a.op)).toEqual(['beat.text']);
  });

  it('projects only the commands that applied', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b404', text: 'a line for a beat that is not there' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' },
    ]);

    // The rejected one changed nothing; the one that applied did.
    expect(out.reel.beats[0].text).toBe('a rewritten line');
    expect(out.reel.beats[1].text).toBe('the second line');
  });

  it('rejects an unknown op the same way the real command path does', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    const out = await previewCommands('grok', [{ op: 'clip.explode', args: {}, actor: 'agent' }]);

    expect(out.rejected[0].detail).toMatchObject({ validOps: expect.arrayContaining(['beat.text']) });
  });

  it('rejects malformed args and hands back the schema they failed', async () => {
    const { previewCommands } = await import('@/lib/reel/preview');
    await seed();

    // No text at all: the schema, not the reel, is what refuses this.
    const out = await previewCommands('grok', [
      { op: 'beat.text', args: { beatId: 'b1' }, actor: 'agent' },
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
