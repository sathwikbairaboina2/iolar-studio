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

  it('writes a copy Kdenlive will show in its open dialog', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');
    const out = await writeHandoff('grok');

    // Kdenlive's file dialog filters to *.kdenlive, so a .mlt is invisible there however
    // well it parses. Same project, a name the dialog admits.
    const both = await fs.readdir(out.dir);
    expect(both).toContain('project.mlt');
    expect(both).toContain('project.kdenlive');

    const mlt = await fs.readFile(path.join(out.dir, 'project.mlt'), 'utf8');
    const kden = await fs.readFile(path.join(out.dir, 'project.kdenlive'), 'utf8');
    expect(kden).toContain('clips/01-lipsync-a1.mp4');
    // The bin Kdenlive reads its project properties from, which plain MLT XML has no need of.
    expect(kden).toContain('main_bin');
    // A timeline clip Kdenlive cannot find in the bin is removed on load, so every clip on
    // the timeline is listed there with the id its entry points back at.
    expect(kden).toContain('<entry producer="clip0"/>');
    expect(kden).toContain('kdenlive:id');
    expect(kden).toContain('kdenlive:docproperties.version');
    expect(mlt).not.toContain('main_bin');
  });

  it('leaves the presenter speaking for himself', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');
    const out = await writeHandoff('grok');

    for (const name of ['project.mlt', 'project.kdenlive']) {
      const xml = await fs.readFile(path.join(out.dir, name), 'utf8');
      const voiceTrack = xml.split('<playlist id="audio">')[1].split('</playlist>')[0];
      // The lipsync take carries the same words as the voiceover for its own stretch, so the
      // voiceover steps aside there — running both is the same line twice, half a frame apart.
      expect(voiceTrack).toContain('in="00:00:00.000"');
      expect(voiceTrack).toContain('in="00:00:09.000"');
      // And nothing mutes the recordings themselves.
      expect(xml).not.toContain('<track producer="video" hide="audio"/>');
    }

    // Shotcut plays a video track's own audio, so the take is simply left alone in the gap.
    const mlt = await fs.readFile(path.join(out.dir, 'project.mlt'), 'utf8');
    expect(mlt.split('<playlist id="audio">')[1].split('</playlist>')[0]).toContain(
      '<blank length="00:00:06.500"/>'
    );

    // Kdenlive never plays a video track's audio — it writes hide="audio" onto every video
    // track of its own. So the take's audio goes on the audio track as well, or the presenter
    // is silent however loud the file is.
    const kden = await fs.readFile(path.join(out.dir, 'project.kdenlive'), 'utf8');
    expect(kden).toContain('<producer id="clip0_audio"');
    expect(kden).toContain('<property name="video_index">-1</property>');
    expect(kden.split('<playlist id="audio">')[1].split('</playlist>')[0]).toContain(
      '<entry producer="clip0_audio" in="00:00:00.000" out="00:00:06.467"/>'
    );
  });

  it('dips to black across a gap instead of cutting into it', async () => {
    await seed();
    const { writeHandoff } = await import('@/lib/reel/handoff');
    const out = await writeHandoff('grok');

    for (const name of ['project.mlt', 'project.kdenlive']) {
      const xml = await fs.readFile(path.join(out.dir, name), 'utf8');
      const clip0 = xml.split('<producer id="clip0"')[1].split('</producer>')[0];
      const clip1 = xml.split('<producer id="clip1"')[1].split('</producer>')[0];

      // Two and a half seconds of nothing open the reel, so the first take arrives out of it
      // rather than snapping on.
      expect(clip0).toContain('fade_from_black');
      // Nothing between the two takes — a cut there is a cut, not a hole to cover.
      expect(clip1).not.toContain('fade_from_black');
      // The voiceover outlasts the last take, so it leaves rather than stops.
      expect(clip1).toContain('fade_to_black');
      expect(clip0).not.toContain('fade_to_black');
    }
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

describe('a recording that runs into its neighbour', () => {
  it('is trimmed to the neighbour, because the surplus is only padding', async () => {
    const { buildProject } = await import('@/lib/reel/handoff');
    const reel = {
      title: 'grok',
      ratio: '9:16',
      fps: 30,
      vo: { durationSec: 12 },
    } as never;
    // The first take was padded to the half-second grid, so it measures 5.5 seconds but
    // its neighbour starts at 5.2.
    const xml = buildProject(reel, [
      { file: 'clips/01.mp4', startsAt: 0, seconds: 5.5, speaks: true },
      { file: 'clips/02.mp4', startsAt: 5.2, seconds: 4.0 },
    ]);

    const video = xml.split('<playlist id="video">')[1].split('</playlist>')[0];
    // 5.2 seconds at 30fps, out = last frame that plays: 5.2 - 1/30 ≈ 5.167
    expect(video).toContain('<entry producer="clip0" in="00:00:00.000" out="00:00:05.16');
    expect(video).not.toContain('<blank length="-');
  });

  it('keeps a clip that fits exactly as it is', async () => {
    const { buildProject } = await import('@/lib/reel/handoff');
    const reel = { title: 'grok', ratio: '9:16', fps: 30, vo: { durationSec: 12 } } as never;
    const xml = buildProject(reel, [
      { file: 'clips/01.mp4', startsAt: 0, seconds: 5.0 },
      { file: 'clips/02.mp4', startsAt: 6.0, seconds: 4.0 },
    ]);

    const video = xml.split('<playlist id="video">')[1].split('</playlist>')[0];
    expect(video).toContain('<entry producer="clip0" in="00:00:00.000" out="00:00:04.96');
    expect(video).toContain('<blank length="00:00:01.000"');
  });
});

describe('the music bed', () => {
  const withMusic = (words: { start: number; end: number }[]) =>
    ({
      title: 'grok',
      ratio: '9:16',
      fps: 30,
      vo: { durationSec: 10, words: words.map((w, i) => ({ w: `w${i}`, ...w })) },
      timeline: { music: { path: 'assets/bed.mp3', gainDb: -18, duckDb: -12 } },
    }) as never;

  it('rides under the voice and comes up in the real pauses', async () => {
    const { duckKeyframes } = await import('@/lib/reel/handoff');
    // One run of words at 1-4s, then real silence.
    const level = duckKeyframes([{ start: 1, end: 4 }], -18, -12);

    const bed = '-18.00';
    const duck = '-30.00';
    // Ducked just before the words, held past them, back to the bed after.
    expect(level).toContain(`00:00:00.900=${duck}`);
    expect(level).toContain(`00:00:04.250=${duck}`);
    expect(level).toContain(`00:00:04.650=${bed}`);
    expect(level.startsWith(`00:00:00.500=${bed}`)).toBe(true);
  });

  it('does not swell into a breath between sentences', async () => {
    const { duckKeyframes } = await import('@/lib/reel/handoff');
    // Two runs 0.8s apart: one merged span, no rise in between.
    const level = duckKeyframes(
      [
        { start: 1, end: 3 },
        { start: 3.8, end: 6 },
      ],
      -18,
      -12
    );
    const bed = '-18.00';
    // Exactly one dip and one rise.
    expect(level.split(bed).length - 1).toBe(2);
  });

  it('is written into the project with its automation', async () => {
    const { buildProject } = await import('@/lib/reel/handoff');
    const xml = buildProject(withMusic([{ start: 1, end: 4 }]), [
      { file: 'clips/01.mp4', startsAt: 0, seconds: 5 },
    ], 'mlt', { music: 'music.mp3' });

    expect(xml).toContain('<playlist id="music">');
    expect(xml).toContain('music.mp3');
    expect(xml).toContain('mlt_service">volume<');
    expect(xml).toContain('<track producer="music" hide="video"/>');
  });

  it('stays out of a reel that has none', async () => {
    const { buildProject } = await import('@/lib/reel/handoff');
    const xml = buildProject(withMusic([]), [{ file: 'clips/01.mp4', startsAt: 0, seconds: 5 }]);
    expect(xml).not.toContain('<playlist id="music">');
    expect(xml).not.toContain('producer id="music"');
  });

  it('rides in the Kdenlive copy too, and sits in the bin', async () => {
    const { buildProject } = await import('@/lib/reel/handoff');
    const xml = buildProject(withMusic([{ start: 1, end: 4 }]), [
      { file: 'clips/01.mp4', startsAt: 0, seconds: 5 },
    ], 'kdenlive', { music: 'music.mp3' });

    const bin = xml.split('main_bin')[1].split('</playlist>')[0];
    expect(bin).toContain('<entry producer="bed"/>');
    expect(xml).toContain('kdenlive:track_name">Music<');
  });
});
