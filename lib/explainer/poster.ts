import { promises as fs } from 'fs';
import { explainerRenderMp4, explainerRenderPoster } from '@/lib/paths';
import { ffprobeMedia, run } from '@/lib/reel/probe';

/**
 * The still the shelf shows for an explainer.
 *
 * Taken three quarters of the way in, never at the start. An explainer is one scene that mutates:
 * it opens on a board still fading in with two log lines under it and fills up beat by beat, so
 * frame 0 is the emptiest picture the reel ever has and the worst possible thumbnail.
 *
 * Nothing here is allowed to fail a render. A poster is a picture of work already on disk, and a
 * missing one costs a placeholder card, so every path out of `write` is a value rather than a throw.
 */

/** Three quarters in: past the last mutation on a five beat board, before the final hold ends. */
const AT = 0.75;

/** How wide the jpg is written. The shelf draws these small; the mp4 is there for a real look. */
const WIDTH = 360;

export function posterTime(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  // Half a second short of the end, so a clip too brief to have a meaningful three quarter mark
  // still seeks to a frame that exists rather than past the last one.
  return Math.max(0, Math.min(durationSec * AT, durationSec - 0.5));
}

/** The poster for one render, or null if it was never written. */
export async function has(slug: string, jobId: string): Promise<boolean> {
  try {
    await fs.access(explainerRenderPoster(slug, jobId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the still out of one mp4 and write it to one path. Answers where it wrote, or null.
 *
 * Split out from `write` because an explainer rendered before renders were jobs has a plain
 * `reel.mp4` and no job id, and it deserves a picture on the shelf like any other.
 */
export async function still(mp4: string, out: string): Promise<string | null> {
  try {
    await fs.access(mp4);
  } catch {
    return null;
  }

  try {
    const { durationSec } = await ffprobeMedia(mp4);
    const { code } = await run('ffmpeg', [
      '-v', 'error', '-y',
      '-ss', String(posterTime(durationSec)),
      '-i', mp4,
      '-frames:v', '1',
      '-vf', `scale=${WIDTH}:-1`,
      '-q:v', '4',
      out,
    ], { timeoutMs: 30_000 });
    if (code !== 0) return null;
    return out;
  } catch {
    // No ffmpeg on this machine, a clip it will not read, a seek past the end: all of them mean
    // no thumbnail, and none of them mean the render went wrong.
    return null;
  }
}

/**
 * Write the poster for a finished render.
 *
 * Called the moment the mp4 lands, which is the one time we know the file is complete and nobody
 * is waiting on the answer.
 */
export function write(slug: string, jobId: string): Promise<string | null> {
  return still(explainerRenderMp4(slug, jobId), explainerRenderPoster(slug, jobId));
}
