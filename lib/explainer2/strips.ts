import { promises as fs } from 'fs';
import path from 'path';
import { explainer2File } from '@/lib/paths';
import { registerVideos, type Command, type Proc } from './commands';
import type { Timing } from './schema';
import { workspacePaths, renderRoot } from './workspace';

/**
 * Motion strips: for each beat, six frames evenly spaced from its first to its last, at 540 x 960, tiled three across
 * into one png. The designer and the critic read these instead of a single mid-beat still, so motion is judged too.
 *
 * One `remotion render --sequence --scale=0.5` of the whole composition is far cheaper than forty separate stills, each
 * of which would bundle the project again; the frames are picked out of that sequence.
 */

export const STRIP_FRAMES = 6;
const COLS = 3;

/** `n` frames evenly spaced from the first frame of the beat to its last (repeats removed for a very short beat). */
export function stripFrames(beat: { start: number; end: number }, n = STRIP_FRAMES): number[] {
  const last = Math.max(beat.start, beat.end - 1);
  const frames = Array.from({ length: n }, (_, k) => beat.start + Math.round((k * (last - beat.start)) / (n - 1)));
  return frames.filter((f, i) => i === 0 || f !== frames[i - 1]);
}

export const sequenceCommand = (slug: string, outDir: string): Command => ({
  cmd: 'npx',
  args: ['remotion', 'render', 'src/index.ts', `designed-${slug}`, outDir, '--sequence', '--image-format=png', '--scale=0.5'],
});

/** The frame a sequence file is for: `element-0042.png` is 42. */
export function frameNumber(file: string): number | null {
  const m = file.match(/(\d+)\.(png|jpe?g)$/i);
  return m ? Number(m[1]) : null;
}

/** Tiles frames three across into one png at `out`. */
export async function tileFrames(files: readonly string[], out: string, cols = COLS): Promise<void> {
  const sharp = (await import('sharp')).default;
  const first = await sharp(files[0]).metadata();
  const w = first.width ?? 540;
  const h = first.height ?? 960;
  const rows = Math.ceil(files.length / cols);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width: w * Math.min(cols, files.length), height: h * rows, channels: 3, background: { r: 11, g: 8, b: 22 } } })
    .composite(files.map((f, i) => ({ input: f, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .png()
    .toFile(out);
}

export type StripDeps = { proc: Proc; root?: string; tile?: (files: string[], out: string) => Promise<void> };
export type Strip = { beat: string; /** The workspace copy, which the critic reads. */ file: string };

/** Renders the strips for every beat. The workspace keeps them under out/designed/<slug>/strips, the studio under strips/. */
export async function renderStrips(slug: string, timing: Timing, deps: StripDeps): Promise<Strip[]> {
  const root = deps.root ?? renderRoot();
  const w = workspacePaths(root, slug);
  const seq = path.join(w.stillsDir, 'seq');
  const stripsDir = path.join(w.stillsDir, 'strips');
  const tile = deps.tile ?? ((files, out) => tileFrames(files, out));

  await registerVideos(root, deps.proc);
  await fs.rm(seq, { recursive: true, force: true });
  await fs.rm(stripsDir, { recursive: true, force: true });
  const c = sequenceCommand(slug, path.join('out', 'designed', slug, 'seq'));
  const r = await deps.proc(c.cmd, c.args, { cwd: root, timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new Error(`the motion strips did not render: ${r.output.trim().slice(-600)}`);

  const byFrame = new Map<number, string>();
  for (const f of await fs.readdir(seq)) {
    const n = frameNumber(f);
    if (n !== null) byFrame.set(n, path.join(seq, f));
  }
  if (!byFrame.size) throw new Error('the motion strips render wrote no frames');
  const have = [...byFrame.keys()].sort((a, b) => a - b);
  const nearest = (frame: number) => have.reduce((best, n) => (Math.abs(n - frame) < Math.abs(best - frame) ? n : best), have[0]);

  const studioDir = explainer2File(slug, 'strips');
  await fs.mkdir(studioDir, { recursive: true });
  const out: Strip[] = [];
  for (const beat of timing.beats) {
    const files = stripFrames(beat).map((f) => byFrame.get(f) ?? byFrame.get(nearest(f))!);
    const file = path.join(stripsDir, `${beat.id}.png`);
    await tile(files, file);
    await fs.copyFile(file, path.join(studioDir, `${beat.id}.png`));
    out.push({ beat: beat.id, file });
  }
  await fs.rm(seq, { recursive: true, force: true });
  return out;
}
