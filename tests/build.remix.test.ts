import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The mix is planned twice: once from word counts before the voiceover exists, and again
 * from the measured take once whisper has placed the words. This file covers the second
 * deal — the one the first plan can only guess at.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-remix-'));
});

const line = (id: string, order: number, text: string) => ({
  id,
  order,
  role: 'body' as const,
  text,
  citations: ['abcdef012345'],
  assetIds: [],
  note: null,
  commentary: false,
});

async function seed(over: Record<string, unknown> = {}) {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  const { writeScript } = await import('@/lib/reel/research/store');
  await createReel('grok');

  await writeScript('grok', {
    runId: 'r1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'approved',
    unsupported: [],
    lines: [line('l1', 1, 'One sentence here.'), line('l2', 2, 'Another one there.'), line('l3', 3, 'And a close.')],
  } as never);

  const reel = await loadReel('grok');
  const shot = (kind: string, lineId: string) => ({ kind, brief: '', hero: false, alsoAssetIds: [], sourceLineId: lineId });
  await saveReel('grok', {
    ...reel,
    beats: [
      { id: 'b1', role: 'hook', text: 'One sentence here.', shot: shot('screen', 'l1') },
      { id: 'b2', role: 'body', text: 'Another one there.', shot: shot('screen', 'l2') },
      { id: 'b3', role: 'close', text: 'And a close.', shot: shot('screen', 'l3') },
    ],
    vo: {
      provider: 'local',
      voiceId: '',
      file: 'vo.mp3',
      durationSec: 18,
      words: [
        { w: 'One', start: 0, end: 2 },
        { w: 'sentence', start: 2, end: 4 },
        { w: 'here.', start: 4, end: 6 },
        { w: 'Another', start: 6, end: 8 },
        { w: 'one', start: 8, end: 10 },
        { w: 'there.', start: 10, end: 12 },
        { w: 'And', start: 12, end: 14 },
        { w: 'a', start: 14, end: 16 },
        { w: 'close.', start: 16, end: 18 },
      ],
    },
    ...over,
  } as never);
}

describe('remixFromAudio', () => {
  it('re-deals the face from the measured take', async () => {
    await seed();
    const { remixFromAudio } = await import('@/lib/reel/build/bridge');

    const out = await remixFromAudio('grok');
    // Six-second beats measured from the audio: the hook earns a face on the take, and the
    // fifteen-second budget cannot also carry the close.
    expect(out.beats[0].shot.kind).toBe('talking-head');
    expect(out.beats.some((b) => b.shot.kind === 'screen')).toBe(true);
  });

  it('does nothing before the voiceover is aligned', async () => {
    await seed({ vo: { provider: 'local', voiceId: '', file: 'vo.mp3', durationSec: 0, words: [] } });
    const { remixFromAudio } = await import('@/lib/reel/build/bridge');

    const out = await remixFromAudio('grok');
    expect(out.beats.map((b) => b.shot.kind)).toEqual(['screen', 'screen', 'screen']);
  });

  it('refuses to re-deal under footage that already exists', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      beats: reel.beats.map((b, i) => (i === 0 ? { ...b, shot: { ...b.shot, assetId: 'a1' } } : b)),
    } as never);
    const { remixFromAudio } = await import('@/lib/reel/build/bridge');

    const out = await remixFromAudio('grok');
    expect(out.beats.map((b) => b.shot.kind)).toEqual(['screen', 'screen', 'screen']);
  });

  it('leaves titles and researched kinds alone', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      beats: reel.beats.map((b, i) => (i === 1 ? { ...b, shot: { ...b.shot, kind: 'title' } } : b)),
    } as never);
    const { remixFromAudio } = await import('@/lib/reel/build/bridge');

    const out = await remixFromAudio('grok');
    expect(out.beats[1].shot.kind).toBe('title');
  });
});
