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
