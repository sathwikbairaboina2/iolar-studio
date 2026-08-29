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
  const { closeOverlayBrowser } = await import('@/lib/reel/overlays');
  await closeOverlayBrowser();
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-parity-'));
});

type Box = { minX: number; maxX: number; minY: number; maxY: number };

function brightBox(data: Buffer | Uint8Array, info: { width: number; height: number; channels: number }): Box {
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] + data[i + 1] + data[i + 2] <= 200) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The parity guard.
 *
 * The DOM preview and the ffmpeg export are two renderers of one timeline. Both draw
 * captions from `patterns/<name>/caption.css` and both take motion from `lib/reel/motion`,
 * so a caption must land on the same pixels either way. The reel is shot over flat black
 * and the preview overlay is composited over black too, which is exactly what the export
 * does — so any difference here is real drift, not a difference in how we measured.
 */
describe('preview / export parity', () => {
  it('burns the caption into the same pixels the preview stylesheet paints', async () => {
    if (!ffmpeg) return;

    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { extractFrames, run } = await import('@/lib/reel/probe');
    const { reelAssetsDir, reelVoFile } = await import('@/lib/paths');
    const { exportReel } = await import('@/lib/reel/ffmpeg');
    const { renderOverlays } = await import('@/lib/reel/overlays');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const sharp = (await import('sharp')).default;
    const root = process.env.IOLAR_DATA_DIR!;

    await createReel('parity', { title: 'Parity' });
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=3:r=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      path.join(reelAssetsDir('parity'), 'a1.mp4'),
    ]);
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', reelVoFile('parity')]);

    const base = await loadReel('parity');
    const reel = {
      ...base,
      fps: 30,
      assets: [{ id: 'a1', kind: 'video' as const, path: 'assets/a1.mp4', origin: 'user' as const, status: 'ready' as const, brief: '' }],
      timeline: {
        ...base.timeline,
        clips: [
          {
            id: 'c1', assetId: 'a1', start: 0, end: 3, srcIn: 0, fit: 'cover' as const,
            motion: { type: 'hold' as const, strength: 0, origin: [0.5, 0.5] as [number, number] },
            transition: 'cut' as const, locked: false,
          },
        ],
        captions: [{ id: 'k1', text: 'just launched', start: 0.5, end: 2.5, hidden: false, locked: false }],
        overlays: [],
      },
    };
    await saveReel('parity', reel);

    const out = await exportReel('parity');
    const [frame] = await extractFrames(out.path, [1.5], path.join(root, 'frames'));
    const overlays = await renderOverlays(reel, await loadPattern('armand'), path.join(root, 'preview'));

    // The preview layer as the export would see it: composited over the black clip.
    const composited = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#000000' } })
      .composite([{ input: overlays.get('k1')! }])
      .png()
      .toBuffer();

    const p = await sharp(composited).raw().toBuffer({ resolveWithObject: true });
    const e = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const preview = brightBox(p.data, p.info);
    const exported = brightBox(e.data, e.info);

    expect(exported.maxY).toBeGreaterThan(0); // the caption really is burnt in
    for (const edge of ['minX', 'maxX', 'minY', 'maxY'] as const) {
      expect(Math.abs(exported[edge] - preview[edge])).toBeLessThanOrEqual(2);
    }

    // And the whole frame agrees, allowing for h264 quantisation.
    let diff = 0;
    for (let i = 0; i < p.data.length; i += p.info.channels) {
      diff += Math.abs(p.data[i] - e.data[i]);
    }
    expect(diff / (p.info.width * p.info.height)).toBeLessThan(6);
  }, 300_000);
});
