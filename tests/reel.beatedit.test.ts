import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Revising a beat after the script was approved.
 *
 * The voiceover on disk speaks the words that were approved. Change them and the audio is
 * of a different script — the words are still there and still aligned, so nothing breaks
 * loudly, which is exactly why the reel has to say so rather than quietly cut against them.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-beat-'));
});

const BEATS = [
  { id: 'b1', role: 'hook' as const, text: 'One two three', shot: { kind: 'talking-head' as const, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
  { id: 'b2', role: 'close' as const, text: 'four five', shot: { kind: 'screen' as const, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
];

async function seed(slug = 'grok') {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  const { scriptHash } = await import('@/lib/reel/script');
  await createReel(slug);
  const reel = await loadReel(slug);
  const next = {
    ...reel,
    beats: BEATS,
    vo: {
      ...reel.vo,
      durationSec: 3,
      words: [{ w: 'One', start: 0, end: 0.4 }],
      scriptHash: scriptHash({ beats: BEATS }),
    },
  };
  await saveReel(slug, next);
  return loadReel(slug);
}

describe('editing a beat', () => {
  it('rewrites the line the reel speaks', async () => {
    const reel = await seed();
    const { editBeatText } = await import('@/lib/reel/edits');

    const out = editBeatText(reel, 'b1', '  One two three four  ');

    expect(out.beats.find((b) => b.id === 'b1')!.text).toBe('One two three four');
  });

  it('leaves the recorded take alone — the words still describe real audio', async () => {
    const reel = await seed();
    const { editBeatText } = await import('@/lib/reel/edits');

    const out = editBeatText(reel, 'b1', 'One two three four');

    expect(out.vo.words).toHaveLength(1);
    expect(out.vo.durationSec).toBe(3);
  });

  it('makes the take stop matching the script, which is how the studio knows to warn', async () => {
    const reel = await seed();
    const { editBeatText } = await import('@/lib/reel/edits');
    const { voMatchesScript } = await import('@/lib/reel/script');

    expect(voMatchesScript(reel)).toBe(true);
    expect(voMatchesScript(editBeatText(reel, 'b1', 'One two three four'))).toBe(false);
  });

  it('refuses an empty line and an unknown beat', async () => {
    const reel = await seed();
    const { editBeatText } = await import('@/lib/reel/edits');

    expect(() => editBeatText(reel, 'b1', '   ')).toThrow(/empty/i);
    expect(() => editBeatText(reel, 'b9', 'x')).toThrow(/b9/);
  });

  it('goes through the same door every other edit does', async () => {
    await seed();
    const { applyCommand } = await import('@/lib/reel/commands');

    const out = await applyCommand('grok', { op: 'beat.text', args: { beatId: 'b2', text: 'four five six' }, actor: 'ui' });

    expect(out.reel.beats.find((b) => b.id === 'b2')!.text).toBe('four five six');
    expect(out.entry.summary).toMatch(/b2/);
  });

  it('a take made for the new words matches again', async () => {
    const reel = await seed();
    const { editBeatText } = await import('@/lib/reel/edits');
    const { scriptHash, voMatchesScript } = await import('@/lib/reel/script');

    const edited = editBeatText(reel, 'b1', 'One two three four');
    const realigned = { ...edited, vo: { ...edited.vo, scriptHash: scriptHash(edited) } };

    expect(voMatchesScript(realigned)).toBe(true);
  });
});
