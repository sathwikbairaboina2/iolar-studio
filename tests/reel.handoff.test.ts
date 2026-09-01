import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Everything an editor needs, and nothing this studio decided.
 *
 * The cut is not ours to make. What we can hand over is what the plugins produced, the
 * voiceover they were rendered against, the script that was approved, and a project file
 * that puts each recording at the moment it was cut for — so opening it lands you where the
 * reel already is rather than at an empty timeline.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-handoff-'));
});

async function seed() {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  const { reelDir } = await import('@/lib/paths');
  await createReel('grok');
  const reel = await loadReel('grok');
  const dir = path.join(reelDir('grok'), 'assets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'a1.mp4'), 'one');
  await fs.writeFile(path.join(dir, 'a2.mp4'), 'two');
  await fs.writeFile(path.join(reelDir('grok'), 'vo.mp3'), 'voice');
  await saveReel('grok', {
    ...reel,
    title: 'Einstein Had No Reference List',
    vo: { ...reel.vo, durationSec: 20, words: [{ w: 'one', start: 0, end: 0.5 }] },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', provider: 'lipsync', status: 'ready', takeStart: 2.5, durationSec: 6.5, brief: '' },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'plugin', provider: 'webpage', status: 'ready', takeStart: 9, durationSec: 10, brief: '' },
    ],
    beats: [
      { id: 'b1', role: 'hook', text: 'First line spoken.', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null, assetId: 'a1' } },
      { id: 'b2', role: 'close', text: 'Second line spoken.', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null, assetId: 'a2' } },
    ],
  } as never);
  return loadReel('grok');
}

describe('handing the reel to an editor', () => {
  it('copies every recording, the voiceover and the script into one folder', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');

    const out = await writeHandoff('grok');

    const names = (await fs.readdir(out.dir)).sort();
    expect(names).toContain('project.mlt');
    expect(names).toContain('script.txt');
    expect(names).toContain('voice.mp3');
    const clips = (await fs.readdir(path.join(out.dir, 'clips'))).sort();
    expect(clips).toEqual(['01-lipsync-a1.mp4', '02-webpage-a2.mp4']);
  });

  it('writes a project that opens where the reel already is', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');
    const out = await writeHandoff('grok');
    const xml = await fs.readFile(path.join(out.dir, 'project.mlt'), 'utf8');

    // 1080x1920 at 30, one producer per recording, and the gap before the first one kept as
    // a gap rather than closed — the editor decides what covers it.
    expect(xml).toContain('width="1080"');
    expect(xml).toContain('frame_rate_num="30"');
    expect(xml).toContain('clips/01-lipsync-a1.mp4');
    expect(xml).toContain('clips/02-webpage-a2.mp4');
    expect(xml).toContain('<blank length="00:00:02.500"');
    expect(xml).toContain('voice.mp3');
  });

  it('writes the script as the words, with who says what', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');
    const out = await writeHandoff('grok');
    const script = await fs.readFile(path.join(out.dir, 'script.txt'), 'utf8');

    expect(script).toContain('Einstein Had No Reference List');
    expect(script).toContain('First line spoken.');
    expect(script).toContain('talking-head');
  });

  it('refuses while a recording is still missing', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    await seed();
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: reel.assets.map((a) => (a.id === 'a2' ? { ...a, status: 'running' as const, path: '' } : a)),
    });
    const { writeHandoff } = await import('@/lib/reel/handoff');
    // Handing over half a reel wastes the trip: the editor would have to come back for it.
    await expect(writeHandoff('grok')).rejects.toThrow(/still rendering|not ready/i);
  });
});
