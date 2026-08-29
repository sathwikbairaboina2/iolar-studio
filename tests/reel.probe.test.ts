import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-probe-'));
let available = false;

beforeAll(async () => {
  const { ffmpegAvailable } = await import('@/lib/reel/probe');
  available = await ffmpegAvailable();
});

describe('ffmpeg helpers', () => {
  it('reports availability without throwing', async () => {
    const { ffmpegAvailable } = await import('@/lib/reel/probe');
    expect(typeof (await ffmpegAvailable())).toBe('boolean');
  });

  it('probes a generated clip', async () => {
    if (!available) return;
    const { makeTestClip, ffprobeMedia } = await import('@/lib/reel/probe');
    const file = path.join(dir, 'clip.mp4');
    await makeTestClip(file, { seconds: 2, width: 320, height: 568, fps: 30, audio: true });
    const info = await ffprobeMedia(file);
    expect(info.width).toBe(320);
    expect(info.height).toBe(568);
    expect(info.fps).toBeCloseTo(30, 1);
    expect(info.durationSec).toBeCloseTo(2, 1);
    expect(info.hasAudio).toBe(true);
  }, 60_000);

  it('extracts frames at requested timestamps', async () => {
    if (!available) return;
    const { makeTestClip, extractFrames } = await import('@/lib/reel/probe');
    const file = path.join(dir, 'frames.mp4');
    await makeTestClip(file, { seconds: 3, width: 320, height: 568, fps: 30, audio: false });
    const out = await extractFrames(file, [0.5, 1.5], path.join(dir, 'frames'), 160);
    expect(out).toHaveLength(2);
    for (const f of out) expect(existsSync(f)).toBe(true);
  }, 60_000);

  it('finds a scene cut where two very different sources meet', async () => {
    if (!available) return;
    const { run, sceneCuts } = await import('@/lib/reel/probe');
    const file = path.join(dir, 'cuts.mp4');
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x568:d=2:r=30',
      '-f', 'lavfi', '-i', 'color=c=white:s=320x568:d=2:r=30',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
    ]);
    const cuts = await sceneCuts(file, 0.3);
    expect(cuts.some((t) => Math.abs(t - 2) < 0.3)).toBe(true);
  }, 90_000);
});
