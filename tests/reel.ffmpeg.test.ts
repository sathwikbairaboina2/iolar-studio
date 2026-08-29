import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let ffmpeg = false;

beforeAll(async () => {
  const { ffmpegAvailable } = await import('@/lib/reel/probe');
  ffmpeg = await ffmpegAvailable();
});

afterAll(async () => {
  const { closeOverlayBrowser } = await import('@/lib/reel/overlays');
  await closeOverlayBrowser();
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-ffmpeg-'));
});

const clip = (id: string, start: number, end: number, over: Record<string, unknown> = {}) => ({
  id,
  assetId: 'a1',
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.5] as [number, number] },
  transition: 'cut' as const,
  locked: false,
  ...over,
});

async function fixture(over: Record<string, unknown> = {}) {
  const { validateReel } = await import('@/lib/reel/schema');
  const { loadPattern } = await import('@/lib/reel/patterns');
  const reel = validateReel({
    pattern: 'armand',
    title: 'Fixture',
    fps: 30,
    beats: [{ id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'broll', brief: '' } }],
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 0, 1.5), clip('c2', 1.5, 3)],
      captions: [{ id: 'k1', text: 'just launched', start: 0.2, end: 1.2 }],
      overlays: [],
      ...(over.timeline ?? {}),
    },
    ...over,
  });
  return { reel, pattern: await loadPattern('armand') };
}

describe('export filter graph', () => {
  it('trims one input per clip and overlays each caption in its own window', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map([['k1', 'C:/x/cap-001.png']]),
      voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect((graph.match(/trim=start=/g) ?? []).length).toBe(2);
    expect(graph).toContain("overlay=x=0:y=0:enable='between(t,0.2,1.2)'");
    expect(graph).toContain('zoompan=');
    expect(args).toContain('C:/x/out.mp4');
    expect(args.join(' ')).toContain('-r 30');
  });

  it('crops for cover and pads with the pattern colour for contain', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      timeline: { clips: [clip('c1', 0, 1.5), clip('c2', 1.5, 3, { fit: 'contain' })], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('crop=1080:1920');
    expect(graph).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#ffffff');
  });

  it('spends a crossfade on extra trimmed footage so the reel keeps its length', async () => {
    const { buildExportArgs, XFADE_SEC } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      timeline: { clips: [clip('c1', 0, 1.5), clip('c2', 1.5, 3, { transition: 'crossfade' })], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(`xfade=transition=fade:duration=${XFADE_SEC}:offset=${1.5 - XFADE_SEC}`);
    // the incoming clip is trimmed 0.25s longer to pay for the overlap
    expect(graph).toContain(`duration=${1.5 + XFADE_SEC}`);
  });

  it('maps the voiceover and ducks music under it when both exist', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: 'C:/x/music.mp3', outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('sidechaincompress');
    expect(args).toContain('[aout]');
    expect(args.join(' ')).toContain('-c:a aac');
  });

  it('refuses to export an empty timeline', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({ timeline: { clips: [], captions: [], overlays: [] } });
    expect(() =>
      buildExportArgs({
        reel, pattern,
        assetPaths: new Map(), overlayPaths: new Map(),
        voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
      })
    ).toThrow(/no clips/i);
  });

  it('reads progress out of the ffmpeg progress stream', async () => {
    const { parseProgress } = await import('@/lib/reel/ffmpeg');
    expect(parseProgress('out_time_ms=1500000\nframe=45\n', 3)).toBeCloseTo(0.5, 3);
    expect(parseProgress('out_time_ms=9000000\n', 3)).toBe(1);
    expect(parseProgress('frame=1\n', 3)).toBeNull();
  });

  it('writes the caption file as text then hashtags', async () => {
    const { captionFile } = await import('@/lib/reel/ffmpeg');
    const { reel } = await fixture({ caption: { text: 'Grok Bot is here.', hashtags: ['#ai', '#xai'] } });
    expect(captionFile(reel)).toBe('Grok Bot is here.\n\n#ai #xai');
  });
});

describe('real encode', () => {
  it('encodes a crossfade that follows a cut', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, ffprobeMedia } = await import('@/lib/reel/probe');
    const { reelAssetsDir } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');

    await createReel('xfade', { title: 'Xfade' });
    await makeTestClip(path.join(reelAssetsDir('xfade'), 'a1.mp4'), {
      seconds: 4, width: 720, height: 1280, fps: 30, audio: false,
    });

    const reel = await loadReel('xfade');
    await saveReel('xfade', {
      ...reel,
      fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: {
        ...reel.timeline,
        // The third clip is the one that matters: by then the accumulator has been
        // through a concat, which changes its timebase out from under xfade.
        clips: [clip('c1', 0, 1), clip('c2', 1, 2), clip('c3', 2, 3, { transition: 'crossfade' })],
        captions: [],
        overlays: [],
      },
    });

    const out = await exportReel('xfade');
    const info = await ffprobeMedia(out.path);
    expect(info.durationSec).toBeCloseTo(3, 0);
    expect(info.width).toBe(1080);
  }, 300_000);


  it('produces a 1080x1920 mp4 of the timeline length with audio and burnt captions', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, ffprobeMedia, run } = await import('@/lib/reel/probe');
    const { reelAssetsDir, reelVoFile } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');

    await createReel('enc', { title: 'Encode' });
    const assets = reelAssetsDir('enc');
    await makeTestClip(path.join(assets, 'a1.mp4'), { seconds: 3, width: 720, height: 1280, fps: 30, audio: false });
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', reelVoFile('enc')]);

    const reel = await loadReel('enc');
    await saveReel('enc', {
      ...reel,
      fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: {
        ...reel.timeline,
        clips: [clip('c1', 0, 1.5), clip('c2', 1.5, 3, { transition: 'crossfade' })],
        captions: [{ id: 'k1', text: 'just launched', start: 0.2, end: 1.2, hidden: false, locked: false }],
        overlays: [{ id: 'o1', kind: 'hook-title', start: 0, end: 1, props: { title: 'Encode test' }, locked: false }],
      },
      caption: { text: 'hello', hashtags: ['#x'] },
    });

    const seen: number[] = [];
    const out = await exportReel('enc', (p) => seen.push(p));
    const info = await ffprobeMedia(out.path);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    expect(info.durationSec).toBeCloseTo(3, 0);
    expect(info.hasAudio).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);

    const { existsSync, readFileSync } = await import('fs');
    const { reelExportDir } = await import('@/lib/paths');
    const capFile = path.join(reelExportDir('enc'), 'caption.txt');
    expect(existsSync(capFile)).toBe(true);
    expect(readFileSync(capFile, 'utf8')).toContain('#x');
  }, 300_000);
});

describe('loudness', () => {
  it('normalises the voiceover to the platform target', async () => {
    const { buildExportArgs, LOUDNORM } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(LOUDNORM);
    expect(args).toContain('[aout]');
  });

  it('normalises the mix, not just a bare voiceover', async () => {
    const { buildExportArgs, LOUDNORM } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: 'C:/x/m.mp3', outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(`amix=inputs=2:duration=first:dropout_transition=0,${LOUDNORM}`);
  });

  it('really lands near the target after an encode', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, run } = await import('@/lib/reel/probe');
    const { reelAssetsDir, reelVoFile } = await import('@/lib/paths');
    const { exportReel, TARGET_LUFS } = await import('@/lib/reel/ffmpeg');

    await createReel('loud', { title: 'Loud' });
    await makeTestClip(path.join(reelAssetsDir('loud'), 'a1.mp4'), {
      seconds: 4, width: 720, height: 1280, fps: 30, audio: false,
    });
    // a deliberately quiet source, the way a local TTS track arrives
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4',
      '-af', 'volume=-20dB', reelVoFile('loud')]);

    const reel = await loadReel('loud');
    await saveReel('loud', {
      ...reel, fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 0, 3)], captions: [], overlays: [] },
    });
    const out = await exportReel('loud');

    const { stdout, stderr } = await run('ffmpeg', ['-hide_banner', '-i', out.path,
      '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
    const m = /\{[^{}]*input_i[^{}]*\}/.exec(`${stdout}${stderr}`);
    expect(m).not.toBeNull();
    const measured = Number(JSON.parse(m![0]).input_i);
    expect(Math.abs(measured - TARGET_LUFS)).toBeLessThan(2.5);
  }, 300_000);
});
