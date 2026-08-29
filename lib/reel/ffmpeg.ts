import { promises as fs } from 'fs';
import path from 'path';
import { Pattern, loadPattern } from './patterns';
import { REEL_RATIOS, Reel } from './schema';
import { sortTimeline, timelineDuration } from './timeline';
import { motionFfmpeg } from './motion';
import { renderOverlays } from './overlays';
import { run } from './probe';
import { loadReel } from './store';
import { reelDir, reelExportDir, reelRendersDir, reelVoFile } from '../paths';

/** Overlap spent by a crossfade. The incoming clip is trimmed longer by the same amount,
 *  so a transition never shortens the reel and captions stay where the words are. */
export const XFADE_SEC = 0.25;

/**
 * Loudness target for the finished reel.
 *
 * Instagram and the rest normalise to about -14 LUFS; the reference reel measures -14.3.
 * A local TTS track lands quieter and flatter than that, so the export normalises rather
 * than shipping something the platform will turn up unpredictably.
 */
export const TARGET_LUFS = -14;
export const TARGET_TRUE_PEAK = -1.5;
export const LOUDNORM = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=11`;

export type ExportInput = {
  reel: Reel;
  pattern: Pattern;
  assetPaths: Map<string, string>;
  overlayPaths: Map<string, string>;
  voPath: string | null;
  musicPath: string | null;
  outPath: string;
};

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

export function buildExportArgs(input: ExportInput): string[] {
  const { reel, pattern, assetPaths, overlayPaths, voPath, musicPath, outPath } = input;
  const timeline = sortTimeline(reel.timeline);
  const [width, height] = REEL_RATIOS[reel.ratio];
  const fps = reel.fps;

  const args: string[] = ['-y', '-v', 'error'];
  const filters: string[] = [];
  let inputIndex = 0;

  // One input per clip: the same asset trimmed twice needs two decoders anyway.
  const clipInput: number[] = [];
  timeline.clips.forEach((clip, i) => {
    const file = assetPaths.get(clip.assetId);
    if (!file) throw new Error(`clip ${clip.id} has no file for asset ${clip.assetId}`);
    const isStill = /\.(png|jpe?g|webp)$/i.test(file);
    const needsXfade = i > 0 && clip.transition === 'crossfade';
    const dur = r3(clip.end - clip.start + (needsXfade ? XFADE_SEC : 0));
    // A still has no timeline of its own, so it is looped for exactly as long as the
    // clip needs and read from the start — its srcIn is meaningless.
    if (isStill) args.push('-loop', '1', '-t', String(dur));
    args.push('-i', file);
    clipInput.push(inputIndex++);
  });

  const overlayInput = new Map<string, number>();
  for (const [id, file] of overlayPaths) {
    args.push('-i', file);
    overlayInput.set(id, inputIndex++);
  }

  const voInput = voPath ? inputIndex++ : -1;
  if (voPath) args.push('-i', voPath);
  const musicInput = musicPath ? inputIndex++ : -1;
  if (musicPath) args.push('-i', musicPath);

  // Per-clip: cut, fit to frame, apply the shared motion, normalise timing.
  timeline.clips.forEach((clip, i) => {
    const needsXfade = i > 0 && clip.transition === 'crossfade';
    const dur = r3(clip.end - clip.start + (needsXfade ? XFADE_SEC : 0));
    const frames = Math.max(1, Math.round(dur * fps));
    const fit =
      clip.fit === 'contain'
        ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${pattern.letterbox.bg}`
        : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

    const file = assetPaths.get(clip.assetId)!;
    const srcIn = /\.(png|jpe?g|webp)$/i.test(file) ? 0 : r3(clip.srcIn);

    filters.push(
      `[${clipInput[i]}:v]` +
        // Pad BEFORE the cut, not after: a clip that starts partway into a short source
        // would otherwise trim past the end and yield no frames at all, silently
        // shortening the reel. Cloning the last frame first guarantees the cut lands.
        `tpad=stop_mode=clone:stop_duration=${r3(srcIn + dur + 1)},` +
        `trim=start=${srcIn}:duration=${dur},setpts=PTS-STARTPTS,` +
        `fps=${fps},${fit},${motionFfmpeg(clip.motion, { fps, frames, width, height })},` +
        `format=yuv420p,setsar=1[v${i}]`
    );
  });

  if (!timeline.clips.length) throw new Error('nothing to export: the timeline has no clips');

  // Join: a cut is a concat, a crossfade is an xfade over the extra tail trimmed above.
  let acc = '[v0]';
  let accDur = timeline.clips[0].end - timeline.clips[0].start;
  for (let i = 1; i < timeline.clips.length; i++) {
    const clip = timeline.clips[i];
    const out = `[j${i}]`;
    if (clip.transition === 'crossfade') {
      // concat leaves the accumulator on a 1/1000000 timebase while a fresh clip is on 1/fps,
      // and xfade refuses inputs whose timebases differ. Normalise both sides first.
      filters.push(
        `${acc}settb=AVTB[xa${i}]`,
        `[v${i}]settb=AVTB[xb${i}]`,
        `[xa${i}][xb${i}]xfade=transition=fade:duration=${XFADE_SEC}:offset=${r3(accDur - XFADE_SEC)}${out}`
      );
    } else {
      filters.push(`${acc}[v${i}]concat=n=2:v=1:a=0${out}`);
    }
    accDur = r3(accDur + (clip.end - clip.start));
    acc = out;
  }

  // Burn captions and titles on top, each only inside its own window.
  let layer = 0;
  for (const cue of [...timeline.captions.filter((c) => !c.hidden), ...timeline.overlays]) {
    const idx = overlayInput.get(cue.id);
    if (idx === undefined) continue;
    const out = `[o${layer++}]`;
    filters.push(
      `${acc}[${idx}:v]overlay=x=0:y=0:enable='between(t,${r3(cue.start)},${r3(cue.end)})'${out}`
    );
    acc = out;
  }

  const maps = ['-map', acc];
  if (voInput >= 0 && musicInput >= 0) {
    const gain = reel.timeline.music.gainDb;
    filters.push(
      `[${musicInput}:a]volume=${gain}dB[music]`,
      `[music][${voInput}:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[ducked]`,
      `[ducked][${voInput}:a]amix=inputs=2:duration=first:dropout_transition=0,${LOUDNORM}[aout]`
    );
    maps.push('-map', '[aout]');
  } else if (voInput >= 0) {
    filters.push(`[${voInput}:a]${LOUDNORM}[aout]`);
    maps.push('-map', '[aout]');
  } else if (musicInput >= 0) {
    filters.push(`[${musicInput}:a]${LOUDNORM}[aout]`);
    maps.push('-map', '[aout]');
  }

  args.push('-filter_complex', filters.join(';'), ...maps);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps));
  if (voInput >= 0 || musicInput >= 0) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', outPath);
  return args;
}

export function parseProgress(chunk: string, totalSec: number): number | null {
  const m = [...chunk.matchAll(/out_time_ms=(\d+)/g)].at(-1);
  if (!m || totalSec <= 0) return null;
  return Math.min(1, Number(m[1]) / 1e6 / totalSec);
}

export function captionFile(reel: Reel): string {
  return [reel.caption.text.trim(), '', reel.caption.hashtags.join(' ')].join('\n');
}

export async function exportReel(
  slug: string,
  onProgress?: (pct: number) => void
): Promise<{ path: string; durationSec: number }> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  if (!reel.timeline.clips.length) throw new Error('nothing to export: assemble the reel first');

  const overlayPaths = await renderOverlays(reel, pattern, reelRendersDir(slug));
  const assetPaths = new Map<string, string>();
  for (const asset of reel.assets) {
    if (asset.path) assetPaths.set(asset.id, path.join(reelDir(slug), asset.path));
  }

  const voPath = await fs
    .access(reelVoFile(slug))
    .then(() => reelVoFile(slug))
    .catch(() => null);
  const musicPath = reel.timeline.music.path
    ? path.join(reelDir(slug), reel.timeline.music.path)
    : null;

  const outDir = reelExportDir(slug);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'reel.mp4');

  const total = timelineDuration(reel.timeline);
  const args = buildExportArgs({ reel, pattern, assetPaths, overlayPaths, voPath, musicPath, outPath });

  const { code, stderr } = await run('ffmpeg', args, {
    onStdout: (chunk) => {
      const pct = parseProgress(chunk, total);
      if (pct !== null) onProgress?.(pct);
    },
  });
  if (code !== 0) throw new Error(`ffmpeg export failed: ${stderr.slice(-500)}`);

  await fs.writeFile(path.join(outDir, 'caption.txt'), captionFile(reel));
  onProgress?.(1);
  return { path: outPath, durationSec: total };
}
