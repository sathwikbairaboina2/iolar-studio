import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let ffmpeg = false;

beforeAll(async () => {
  const { ffmpegAvailable } = await import('@/lib/reel/probe');
  ffmpeg = await ffmpegAvailable();
});

afterAll(async () => {
  const { closeSceneBrowser } = await import('@/lib/reel/scenes');
  await closeSceneBrowser();
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-scene-'));
});

describe('scene timing', () => {
  it('turns a duration into an exact frame count', async () => {
    const { frameCount } = await import('@/lib/reel/scenes');
    expect(frameCount(4, 30)).toBe(120);
    expect(frameCount(4.5, 30)).toBe(135);
    expect(frameCount(0, 30)).toBe(1);
  });

  it('runs progress from 0 to 1 across the frames', async () => {
    const { frameProgress } = await import('@/lib/reel/scenes');
    expect(frameProgress(0, 120)).toBe(0);
    expect(frameProgress(119, 120)).toBe(1);
    expect(frameProgress(0, 1)).toBe(0);
  });
});

describe('recording a scene', () => {
  it('records the authored UI as real footage at reel size', async () => {
    if (!ffmpeg) return;
    const { recordScene } = await import('@/lib/reel/scenes');
    const { ffprobeMedia } = await import('@/lib/reel/probe');
    const out = path.join(process.env.IOLAR_DATA_DIR!, 'roster.mp4');
    const res = await recordScene({
      htmlPath: path.join(process.cwd(), 'scenes', 'agent-roster', 'scene.html'),
      outPath: out,
      seconds: 1,
    });
    expect(res.frames).toBe(30);
    const info = await ffprobeMedia(out);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    expect(info.durationSec).toBeCloseTo(1, 1);
  }, 300_000);

  it('actually moves — a scene that renders identical frames is not footage', async () => {
    if (!ffmpeg) return;
    const { recordScene } = await import('@/lib/reel/scenes');
    const { extractFrames } = await import('@/lib/reel/probe');
    const sharp = (await import('sharp')).default;
    const dir = process.env.IOLAR_DATA_DIR!;
    const out = path.join(dir, 'move.mp4');
    await recordScene({
      htmlPath: path.join(process.cwd(), 'scenes', 'agent-roster', 'scene.html'),
      outPath: out,
      seconds: 2,
    });
    const [a, b] = await extractFrames(out, [0.1, 1.9], path.join(dir, 'f'), 240);
    const pa = await sharp(a).greyscale().raw().toBuffer();
    const pb = await sharp(b).greyscale().raw().toBuffer();
    let diff = 0;
    for (let i = 0; i < pa.length; i++) diff += Math.abs(pa[i] - pb[i]);
    expect(diff / pa.length).toBeGreaterThan(4);
  }, 300_000);
});

describe('scenes start underway', () => {
  it('never opens on the scene empty state', async () => {
    const { frameProgress } = await import('@/lib/reel/scenes');
    expect(frameProgress(0, 120, 0.12)).toBeCloseTo(0.12, 5);
    expect(frameProgress(119, 120, 0.12)).toBeCloseTo(1, 5);
    // and still spans the whole animation when asked to start at zero
    expect(frameProgress(0, 120, 0)).toBe(0);
  });

  it('records a first frame carrying more than the scene empty state', async () => {
    if (!ffmpeg) return;
    const { recordScene } = await import('@/lib/reel/scenes');
    const { extractFrames } = await import('@/lib/reel/probe');
    const sharp = (await import('sharp')).default;
    const dir = process.env.IOLAR_DATA_DIR!;
    const scene = path.join(process.cwd(), 'scenes', 'terminal-install', 'scene.html');

    const ink = async (file: string) => {
      const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
      let lit = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 60) lit++;
      return lit / (info.width * info.height);
    };

    // the terminal is the worst case: at zero it is a bare prompt on black
    const cold = path.join(dir, 'cold.mp4');
    await recordScene({ htmlPath: scene, outPath: cold, seconds: 1, startAt: 0 });
    const warm = path.join(dir, 'warm.mp4');
    await recordScene({ htmlPath: scene, outPath: warm, seconds: 1 });

    const [coldFirst] = await extractFrames(cold, [0.02], path.join(dir, 'c'), 240);
    const [warmFirst] = await extractFrames(warm, [0.02], path.join(dir, 'w'), 240);
    expect(await ink(warmFirst)).toBeGreaterThan(await ink(coldFirst));
  }, 300_000);
});
