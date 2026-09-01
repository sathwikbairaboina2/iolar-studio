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
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' }],
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

describe('a recording is used as it came back', () => {
  const held = { motion: { type: 'hold' as const, strength: 0, origin: [0.5, 0.5] as [number, number] } };

  it('does not run a held clip through zoompan', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      timeline: { clips: [clip('c1', 0, 3, held)], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    // zoompan resamples every frame even at zoom 1. Footage meant to be held is scaled to
    // the frame and otherwise left as it came back.
    expect(graph).not.toContain('zoompan');
    expect(graph).toContain('scale=1080:1920');
  });

  it('freezes a recording held past its end instead of looping it back to frame one', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', provider: 'lipsync', takeStart: 0, durationSec: 9 }],
      timeline: { clips: [clip('c1', 0, 11, held)], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: null, outPath: 'C:/x/out.mp4',
    });

    // Looping restarted the performance two seconds before the end while its audio had
    // already finished — the mouth moving against the wrong words, which is the one thing
    // a lipsync take must never do.
    const before = args.slice(0, args.indexOf('-i', args.indexOf('C:/x/a1.mp4') - 2));
    expect(before.join(' ')).not.toContain('-stream_loop -1');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('tpad=stop_mode=clone');
  });

  it('silences the voiceover only while the recording is actually speaking', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', provider: 'lipsync', takeStart: 0, durationSec: 9 }],
      timeline: { clips: [clip('c1', 0, 11, held)], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: null, outPath: 'C:/x/out.mp4',
    });

    // Nine seconds of the clip's own audio, then the voiceover carries the words spoken over
    // the frozen tail. Silencing the whole eleven would have dropped them.
    expect(args[args.indexOf('-filter_complex') + 1]).toContain("volume=0:enable='between(t,0,9)'");
  });

  it('takes the audio from the recording rather than laying the voiceover over it', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', provider: 'lipsync', takeStart: 2.5, durationSec: 3 }],
      timeline: { clips: [clip('c1', 2.5, 5.5, held)], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(),
      voPath: 'C:/x/vo.mp3', musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    // The lips are in step with the audio inside the file. Playing the voiceover over the
    // top puts a second copy of the words against them.
    expect(graph).toContain('adelay=2500|2500');
    expect(graph).toContain("volume=0:enable='between(t,2.5,5.5)'");
  });
});

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

describe('clips that start partway into their source', () => {
  it('pads before the cut, so a split beat cannot shorten the reel', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      timeline: {
        // the second clip reads from 1.5s into a source that is only 1.5s long
        clips: [clip('c1', 0, 1.5), clip('c2', 1.5, 3, { srcIn: 1.5 })],
        captions: [], overlays: [],
      },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(), voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    // the pad has to come first; trimming an exhausted stream yields no frames at all
    expect(graph).toMatch(/tpad=stop_mode=clone:stop_duration=[\d.]+,trim=start=1\.5/);
  });

  it('reads a still from its start, since a still has no source timeline', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture({
      timeline: { clips: [clip('c1', 0, 1.5, { srcIn: 4 })], captions: [], overlays: [] },
    });
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/frame.png']]),
      overlayPaths: new Map(), voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('trim=start=0:duration=1.5');
  });

  it('encodes a split beat to its full length', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, ffprobeMedia } = await import('@/lib/reel/probe');
    const { reelAssetsDir } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');

    await createReel('split', { title: 'Split' });
    // a 2s source carrying two 2s clips: the second starts where the source ends
    await makeTestClip(path.join(reelAssetsDir('split'), 'a1.mp4'), {
      seconds: 2, width: 720, height: 1280, fps: 30, audio: false,
    });
    const reel = await loadReel('split');
    await saveReel('split', {
      ...reel, fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: {
        ...reel.timeline,
        clips: [clip('c1', 0, 2), clip('c2', 2, 4, { srcIn: 2 })],
        captions: [], overlays: [],
      },
    });
    const out = await exportReel('split');
    expect((await ffprobeMedia(out.path)).durationSec).toBeCloseTo(4, 0);
  }, 300_000);
});

describe('two-pass loudness', () => {
  it('reads the measurement out of ffmpeg json', async () => {
    const { parseLoudness } = await import('@/lib/reel/ffmpeg');
    const out = 'noise\n{"input_i":"-19.4","input_tp":"-3.1","input_lra":"2.0","input_thresh":"-29.6","target_offset":"0.2"}\n';
    expect(parseLoudness(out)?.input_i).toBe('-19.4');
    expect(parseLoudness('nothing here')).toBeNull();
  });

  it('runs linear when it has measurements, and falls back when it does not', async () => {
    const { loudnormFilter, LOUDNORM } = await import('@/lib/reel/ffmpeg');
    const f = loudnormFilter({
      input_i: '-19.4', input_tp: '-3.1', input_lra: '2.0', input_thresh: '-29.6', target_offset: '0.2',
    });
    expect(f).toContain('measured_I=-19.4');
    expect(f).toContain('linear=true');
    expect(loudnormFilter(null)).toBe(LOUDNORM);
  });

  it('lands within half a decibel of target on a quiet flat source', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, run } = await import('@/lib/reel/probe');
    const { reelAssetsDir, reelVoFile } = await import('@/lib/paths');
    const { exportReel, measureLoudness, TARGET_LUFS } = await import('@/lib/reel/ffmpeg');

    await createReel('loud2', { title: 'Loud2' });
    await makeTestClip(path.join(reelAssetsDir('loud2'), 'a1.mp4'), {
      seconds: 4, width: 720, height: 1280, fps: 30, audio: false,
    });
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4',
      '-af', 'volume=-22dB', reelVoFile('loud2')]);

    const reel = await loadReel('loud2');
    await saveReel('loud2', {
      ...reel, fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 0, 3)], captions: [], overlays: [] },
    });
    const out = await exportReel('loud2');
    const stats = await measureLoudness(out.path);
    expect(Math.abs(Number(stats!.input_i) - TARGET_LUFS)).toBeLessThan(1);
  }, 300_000);
});

describe('delivery format', () => {
  it('ships 48kHz stereo audio, whatever the voice engine produced', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(), voPath: 'C:/x/vo.mp3', musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const joined = args.join(' ');
    expect(joined).toContain('-ar 48000');
    expect(joined).toContain('-ac 2');
  });

  it('limits the voice, because gain alone cannot reach the target', async () => {
    const { VOICE_CHAIN } = await import('@/lib/reel/ffmpeg');
    expect(VOICE_CHAIN).toContain('alimiter');
    expect(VOICE_CHAIN).toContain('acompressor');
  });

  it('really lands 48kHz stereo after an encode', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, run, ffprobeMedia } = await import('@/lib/reel/probe');
    const { reelAssetsDir, reelVoFile } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');

    await createReel('fmt', { title: 'Fmt' });
    await makeTestClip(path.join(reelAssetsDir('fmt'), 'a1.mp4'), {
      seconds: 3, width: 720, height: 1280, fps: 30, audio: false,
    });
    // a mono 24kHz voice track, the way the local engines hand it over
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
      '-ac', '1', '-ar', '24000', reelVoFile('fmt')]);

    const reel = await loadReel('fmt');
    await saveReel('fmt', {
      ...reel, fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 0, 2)], captions: [], overlays: [] },
    });
    const out = await exportReel('fmt');
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=sample_rate,channels', '-of', 'json', out.path]);
    const a = JSON.parse(stdout).streams[0];
    expect(a.sample_rate).toBe('48000');
    expect(a.channels).toBe(2);
    expect((await ffprobeMedia(out.path)).hasAudio).toBe(true);
  }, 300_000);
});

describe('footage shorter than its clip', () => {
  it('loops video rather than freezing on its last frame', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/a1.mp4']]),
      overlayPaths: new Map(), voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    expect(args.join(' ')).toContain('-stream_loop -1');
  });

  it('does not loop a still, which is looped by duration instead', async () => {
    const { buildExportArgs } = await import('@/lib/reel/ffmpeg');
    const { reel, pattern } = await fixture();
    const args = buildExportArgs({
      reel, pattern,
      assetPaths: new Map([['a1', 'C:/x/frame.png']]),
      overlayPaths: new Map(), voPath: null, musicPath: null, outPath: 'C:/x/out.mp4',
    });
    const joined = args.join(' ');
    expect(joined).toContain('-loop 1');
    expect(joined).not.toContain('-stream_loop');
  });

  it('fills a long clip from short footage without a frozen frame', async () => {
    if (!ffmpeg) return;
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { makeTestClip, run } = await import('@/lib/reel/probe');
    const { reelAssetsDir } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');

    await createReel('loopy', { title: 'Loopy' });
    // two seconds of footage asked to cover five
    await makeTestClip(path.join(reelAssetsDir('loopy'), 'a1.mp4'), {
      seconds: 2, width: 720, height: 1280, fps: 30, audio: false,
    });
    const reel = await loadReel('loopy');
    await saveReel('loopy', {
      ...reel, fps: 30,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 0, 5)], captions: [], overlays: [] },
    });
    const out = await exportReel('loopy');
    const { stdout, stderr } = await run('ffmpeg', ['-v', 'info', '-i', out.path,
      '-vf', 'freezedetect=n=0.003:d=0.8', '-f', 'null', '-']);
    expect(`${stdout}${stderr}`).not.toContain('freeze_start');
  }, 300_000);
});
