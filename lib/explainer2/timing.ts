import type { Timing } from './schema';

/** Breathing room after the narration ends, and the shortest a beat may run. */
export const PAD_SECONDS = 0.35;
export const MIN_BEAT_SECONDS = 2.2;
/** The first beat carries the cost-delta hook, which needs time to read. */
export const MIN_HOOK_SECONDS = 2.5;

/**
 * timing.json from the measured length of each beat's voice clip: a beat runs the clip plus a short pad,
 * never under the floor. Beats are contiguous, so the last end is the composition's duration.
 */
export function computeTiming(clips: readonly { id: string; seconds: number }[], fps = 30): Timing {
  let at = 0;
  const beats = clips.map((c, i) => {
    const seconds = Math.max(c.seconds + PAD_SECONDS, i === 0 ? MIN_HOOK_SECONDS : MIN_BEAT_SECONDS);
    const start = at;
    at += Math.ceil(seconds * fps);
    return { id: c.id, start, end: at };
  });
  return { fps, totalFrames: at, beats };
}

/** The frame in the middle of beat `i`, where the designer and the gates take a still. */
export function beatMiddle(timing: Timing, i: number): number {
  const b = timing.beats[i];
  return Math.floor((b.start + b.end) / 2);
}

/**
 * Frames from the start of the hook beat to its peak: the frame where the after counter has settled and glows. It mirrors
 * the kit's `HOOK.settle` (46 frames for a DeltaHook that starts on the beat's first frame) plus a couple of frames of glow.
 */
export const HOOK_PEAK_OFFSET = 48;

/** The frame the cover (poster) is taken at: the hook's peak, kept inside the first beat. */
export function coverFrame(timing: Timing): number {
  const b = timing.beats[0];
  if (!b) return 0;
  return Math.min(b.start + HOOK_PEAK_OFFSET, Math.max(b.start, b.end - 1));
}

export type CaptionMethod = 'whisper' | 'even' | 'mixed' | 'none';

/** How the caption words were timed over every beat; `none` for a timing file from before word timing existed. */
export function captionMethod(timing: Timing | null): CaptionMethod {
  const methods = timing?.beats.map((b) => b.method) ?? [];
  if (!methods.length || methods.every((m) => !m)) return 'none';
  if (methods.every((m) => m === 'whisper')) return 'whisper';
  if (methods.every((m) => m === 'even')) return 'even';
  return 'mixed';
}
