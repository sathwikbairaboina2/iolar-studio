import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Browser, chromium } from 'playwright';
import { REEL_RATIOS } from './schema';
import { run } from './probe';

/**
 * Screen footage rendered from markup instead of borrowed from somewhere.
 *
 * A reel's screen shots are the hardest part to fake: a still with a camera move reads as a
 * slideshow, and a video model turns UI text into mush. An authored HTML scene, scrolled and
 * captured frame by frame, is a genuine screen recording — real motion, text that stays
 * exactly as written, and no footage taken from anyone else.
 *
 * The scene is a plain HTML file. It moves by declaring keyframes in `window.SCENE`:
 * every frame the recorder sets `document.body.dataset.t` to the progress through the shot,
 * and the scene's own CSS/JS decides what that means — usually scrolling a list.
 */

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'],
    });
  }
  return browserPromise;
}

export async function closeSceneBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

export type SceneOptions = {
  /** Absolute path to the scene's HTML file. */
  htmlPath: string;
  outPath: string;
  seconds: number;
  fps?: number;
  ratio?: string;
  /**
   * Rendered at a phone-sized viewport and scaled up.
   *
   * Deliberately smaller than the output frame: the UI then fills the shot the way a real
   * phone capture does, instead of sitting in a pool of empty background, and there is
   * enough overflow for a scroll to actually travel.
   */
  viewport?: { width: number; height: number };
};

export function frameCount(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** Progress through the shot, 0..1, for frame `i` of `total`. */
export function frameProgress(i: number, total: number): number {
  return total <= 1 ? 0 : i / (total - 1);
}

/**
 * Records a scene to an mp4.
 *
 * Frames are captured one at a time rather than with Playwright's own video recorder: that
 * records in real time and drops frames under load, and a reel needs an exact frame count
 * for an exact duration.
 */
export async function recordScene(opts: SceneOptions): Promise<{ path: string; frames: number }> {
  const fps = opts.fps ?? 30;
  const [outW, outH] = REEL_RATIOS[opts.ratio ?? '9:16'];
  const viewport = opts.viewport ?? { width: 430, height: 764 };
  const total = frameCount(opts.seconds, fps);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iolar-scene-'));
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });

  try {
    await page.goto('file://' + opts.htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    for (let i = 0; i < total; i++) {
      const t = frameProgress(i, total);
      await page.evaluate((progress) => {
        document.body.dataset.t = String(progress);
        const w = window as unknown as { SCENE?: { frame?: (p: number) => void } };
        w.SCENE?.frame?.(progress);
      }, t);
      await page.screenshot({ path: path.join(dir, `f${String(i + 1).padStart(5, '0')}.png`) });
    }

    await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
    const { code, stderr } = await run('ffmpeg', [
      '-v', 'error', '-y',
      '-framerate', String(fps),
      '-i', path.join(dir, 'f%05d.png'),
      '-vf', `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      opts.outPath,
    ]);
    if (code !== 0) throw new Error(`scene encode failed: ${stderr.slice(0, 300)}`);
    return { path: opts.outPath, frames: total };
  } finally {
    await page.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
