import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { Pattern, validatePattern } from './patterns';
import { patternDir, patternsRoot, slugify } from '../paths';
import { ffprobeMedia, sampleFrames, sceneCuts } from './probe';
import { transcribe } from './align';
import { Word } from './schema';

export type CloneReport = {
  measured: string[];
  guessed: string[];
  caveats: string[];
  cuts: number[];
  durationSec: number;
  fps: number;
};

/**
 * Scene-detection threshold for counting cuts.
 *
 * Measured against the reference reel: 0.3 finds 21 shots, 0.4 finds 18, 0.6 finds 15,
 * against about 13 real cuts. Screen recordings change content inside a single shot, so
 * any threshold over-counts — 0.4 keeps genuine cuts without splitting every scroll.
 */
export const SCENE_THRESHOLD = 0.4;

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** The shortest gap counted as a real shot; scene detectors routinely fire on frame 1. */
export const MIN_SHOT_SEC = 0.2;

/** Caption-band sampling rate: fast enough to catch a 1-2 word beat, cheap enough to scan a whole reel. */
export const BAND_SAMPLE_FPS = 8;

/** Shot lengths are the gaps between cuts, including the head and tail segments. */
export function shotLengths(cuts: number[], durationSec: number): number[] {
  const marks = [0];
  for (const c of [...cuts].sort((a, b) => a - b)) {
    // A cut sitting on top of the previous one is detector noise, not a new shot.
    if (c > marks.at(-1)! + MIN_SHOT_SEC && c < durationSec - MIN_SHOT_SEC) marks.push(c);
  }
  marks.push(durationSec);

  const out: number[] = [];
  for (let i = 1; i < marks.length; i++) out.push(Math.round((marks[i] - marks[i - 1]) * 100) / 100);
  return out;
}

export type CaptionBand = {
  yPct: number;
  sizeVh: number;
  pill: string;
  pillAlpha: number;
  topPx: number;
  bottomPx: number;
} | null;

/** Rows of a frame holding a run of near-white pixels, as a fraction of the width. */
function brightRows(
  data: Buffer | Uint8Array,
  info: { width: number; height: number; channels: number },
  fromY: number,
  toY: number
): { y: number; frac: number; centreX: number }[] {
  const rows: { y: number; frac: number; centreX: number }[] = [];
  for (let y = fromY; y < toY; y++) {
    let bright = 0;
    let sumX = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) {
        bright++;
        sumX += x;
      }
    }
    if (bright) rows.push({ y, frac: bright / info.width, centreX: sumX / bright / info.width });
  }
  return rows;
}

/**
 * Locates the burnt-in caption band.
 *
 * Burnt-in captions are a specific shape: a short, horizontally centred run of near-white
 * pixels in the lower third. Screen recordings and article screenshots are also bright, so
 * a band only counts when it is short (under a tenth of the frame), centred, and does not
 * fill the width — that is what separates a caption from a white webpage behind it.
 */
export async function measureCaptionBand(framePaths: string[]): Promise<CaptionBand> {
  const centres: number[] = [];
  const heights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  let darkPill = 0;
  let samples = 0;

  for (const file of framePaths) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const fromY = Math.floor(info.height * 0.55);
    const toY = Math.floor(info.height * 0.95);
    const rows = brightRows(data, info, fromY, toY).filter(
      (r) => r.frac > 0.02 && r.frac < 0.75 && Math.abs(r.centreX - 0.5) < 0.14
    );
    if (rows.length < 4) continue;

    // Keep the densest contiguous run: caption glyphs sit together in one band.
    let bestTop = rows[0].y;
    let bestBottom = rows[0].y;
    let top = rows[0].y;
    let prev = rows[0].y;
    for (const r of rows.slice(1)) {
      if (r.y - prev > 6) {
        if (prev - top > bestBottom - bestTop) {
          bestTop = top;
          bestBottom = prev;
        }
        top = r.y;
      }
      prev = r.y;
    }
    if (prev - top > bestBottom - bestTop) {
      bestTop = top;
      bestBottom = prev;
    }

    const heightPct = ((bestBottom - bestTop) / info.height) * 100;
    if (heightPct < 0.8 || heightPct > 10) continue; // too thin to be text, or a bright background

    centres.push(((bestTop + bestBottom) / 2 / info.height) * 100);
    heights.push(heightPct);
    tops.push(bestTop);
    bottoms.push(bestBottom);
    samples++;

    // Just above the glyphs: a pill shows as a flat block, no pill leaves the footage.
    const probeY = Math.max(0, bestTop - Math.round((bestBottom - bestTop) * 0.45));
    const probeX = Math.round(info.width * 0.5);
    const i = (probeY * info.width + probeX) * info.channels;
    if (data[i] + data[i + 1] + data[i + 2] < 200) darkPill++;
  }

  if (samples < 2) return null;
  return {
    yPct: Math.round(percentile(centres, 0.5) * 10) / 10,
    // Cap height is the glyph band; the rendered font size is a shade larger.
    sizeVh: Math.round(percentile(heights, 0.5) * 1.35 * 10) / 10,
    pill: darkPill > samples / 2 ? '#000000' : '#ffffff',
    pillAlpha: darkPill > samples / 2 ? 0.85 : 0.7,
    topPx: Math.round(percentile(tops, 0.5)),
    bottomPx: Math.round(percentile(bottoms, 0.5)),
  };
}

/**
 * Counts how often the caption actually changes on screen.
 *
 * Word pauses cannot tell you this: a creator reading fluently has no gaps, yet the
 * caption still flips every couple of words. So watch the caption band itself and
 * count the frames where it changes.
 */
export async function measureCaptionBeats(
  bandFrames: string[],
  sampleFps: number
): Promise<{ beats: number; beatSec: number[] }> {
  const gaps: number[] = [];
  let previous: Buffer | null = null;
  let lastChangeAt = 0;
  let beats = 0;

  for (const [i, file] of bandFrames.entries()) {
    const { data } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
    const buf = Buffer.from(data);
    if (previous) {
      let diff = 0;
      for (let p = 0; p < buf.length; p++) diff += Math.abs(buf[p] - previous[p]);
      const mean = diff / buf.length;
      if (mean > 6) {
        const at = i / sampleFps;
        if (at - lastChangeAt > 0.15) {
          if (beats > 0) gaps.push(Math.round((at - lastChangeAt) * 100) / 100);
          lastChangeAt = at;
          beats++;
        }
      }
    }
    previous = buf;
  }
  return { beats, beatSec: gaps };
}

/** Words that fall inside each on-screen caption interval. */
export function wordsPerBeatFrom(words: Word[], beatSec: number[]): [number, number] {
  if (!words.length || beatSec.length < 3) return [1, 3];
  const spoken = words.at(-1)!.end - words[0].start;
  const meanBeat = beatSec.reduce((a, b) => a + b, 0) / beatSec.length;
  const perBeat = (words.length / spoken) * meanBeat;
  return [Math.max(1, Math.floor(perBeat * 0.7)), Math.max(2, Math.ceil(perBeat * 1.3))];
}

export async function clonePattern(
  mediaUrl: string,
  name?: string
): Promise<{ name: string; pattern: Pattern; report: CloneReport }> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'iolar-clone-'));
  const file = path.join(work, 'reference.mp4');
  const r = await fetch(mediaUrl);
  if (!r.ok) throw new Error(`reference fetch ${mediaUrl} -> ${r.status}`);
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));

  const info = await ffprobeMedia(file);
  const cuts = await sceneCuts(file, SCENE_THRESHOLD);
  const lengths = shotLengths(cuts, info.durationSec);

  const measured: string[] = ['pacing.shotSec', 'hook.durationSec'];
  const guessed: string[] = ['motion', 'transitions', 'shotMix', 'voice'];

  // Where the captions sit: one cheap pass over evenly spaced frames.
  const frames = await sampleFrames(file, path.join(work, 'frames'), {
    fps: Math.max(0.25, 20 / Math.max(1, info.durationSec)),
  });
  const band = await measureCaptionBand(frames);
  if (band) measured.push('caption.yPct', 'caption.sizeVh', 'caption.pill');
  else guessed.push('caption.yPct', 'caption.sizeVh', 'caption.pill');

  // How fast they change: watch the band itself rather than inferring from speech pauses.
  let rhythm = { wordsPerBeat: [1, 3] as [number, number], beatSec: [0.4, 1.1] as [number, number] };
  if (band) {
    const padding = Math.round((band.bottomPx - band.topPx) * 0.6);
    const bandFrames = await sampleFrames(file, path.join(work, 'band'), {
      fps: BAND_SAMPLE_FPS,
      width: 240,
      crop: {
        w: info.width,
        h: Math.max(8, band.bottomPx - band.topPx + padding * 2),
        x: 0,
        y: Math.max(0, band.topPx - padding),
      },
    });
    const { beatSec } = await measureCaptionBeats(bandFrames, BAND_SAMPLE_FPS);
    if (beatSec.length >= 3) {
      rhythm.beatSec = [
        Math.round(percentile(beatSec, 0.2) * 100) / 100,
        Math.round(percentile(beatSec, 0.8) * 100) / 100,
      ];
      measured.push('pacing.captionBeatSec');
      try {
        const { words } = await transcribe(file);
        rhythm.wordsPerBeat = wordsPerBeatFrom(words, beatSec);
        measured.push('caption.wordsPerBeat');
      } catch {
        guessed.push('caption.wordsPerBeat');
      }
    } else {
      guessed.push('pacing.captionBeatSec', 'caption.wordsPerBeat');
    }
  } else {
    guessed.push('pacing.captionBeatSec', 'caption.wordsPerBeat');
  }

  const slug = slugify(name ?? `clone-${Date.now()}`);
  const dirName = slug.endsWith('-draft') ? slug : `${slug}-draft`;
  const firstCut = cuts.find((c) => c > 0.6) ?? 1.6;

  const pattern = validatePattern({
    name: dirName,
    displayName: `${name ?? 'Cloned creator'} (draft)`,
    caption: {
      font: "Inter, 'Segoe UI', system-ui, sans-serif",
      weight: 800,
      sizeVh: band?.sizeVh ?? 3.2,
      case: 'none',
      fg: '#ffffff',
      pill: band?.pill ?? '#000000',
      pillAlpha: band?.pillAlpha ?? 0.85,
      radiusVh: 0.9,
      padVh: [0.5, 1.1],
      yPct: band?.yPct ?? 73,
      wordsPerBeat: rhythm.wordsPerBeat,
      maxChars: 22,
    },
    pacing: {
      shotSec: [
        Math.max(1, Math.round(percentile(lengths, 0.2) * 10) / 10),
        Math.max(2, Math.round(percentile(lengths, 0.8) * 10) / 10),
      ],
      captionBeatSec: rhythm.beatSec,
      cutOnWordBoundary: true,
    },
    hook: {
      layout: 'title-over-broll',
      durationSec: Math.round(Math.min(3, firstCut) * 10) / 10,
      titleSizeVh: 6,
      logoLockup: true,
    },
    shotMix: { talkingHead: 0.35, screen: 0.45, broll: 0.2, anchorEverySec: 10 },
    motion: { default: 'zoom-in', strength: 0.12 },
    transitions: ['cut', 'cut', 'crossfade'],
    voice: { higgsfieldVoiceId: '', rate: 1 },
    letterbox: { bg: '#ffffff' },
  });

  const report: CloneReport = {
    measured,
    guessed,
    caveats: [
      'pacing.shotSec is a lower bound: screen recordings and fast zooms register as cuts, so shots read shorter than they are.',
      'Everything here is a starting point — edit pattern.json and caption.css by hand.',
    ],
    cuts,
    durationSec: info.durationSec,
    fps: info.fps,
  };

  const dir = patternDir(dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'pattern.json'), JSON.stringify(pattern, null, 2));
  await fs.copyFile(
    path.join(patternsRoot(), 'armand', 'caption.css'),
    path.join(dir, 'caption.css')
  );
  await fs.copyFile(path.join(patternsRoot(), 'armand', 'hook.html'), path.join(dir, 'hook.html'));
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.rm(work, { recursive: true, force: true });

  return { name: dirName, pattern, report };
}
