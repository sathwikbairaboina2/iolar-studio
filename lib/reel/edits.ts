import { CaptionCue, Clip, Reel, Timeline } from './schema';
import { sortTimeline } from './timeline';

/**
 * Every studio edit lives here as a pure function of the reel.
 *
 * There is one. Trimming, splitting, reordering and captioning left with the cut; what
 * remains is what only the studio knows, which is what each beat says.
 */

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;
const MIN_CLIP = 0.2;

function withTimeline(reel: Reel, timeline: Timeline): Reel {
  return { ...reel, timeline: sortTimeline(timeline) };
}

/** Closes gaps left by a trim or a delete, preserving each clip's own length. */
export function editBeatText(reel: Reel, beatId: string, text: string): Reel {
  const next = text.trim();
  if (!next) throw new Error('a beat cannot be empty — delete it instead of emptying it');
  if (!reel.beats.some((b) => b.id === beatId)) throw new Error(`no beat ${beatId} in this reel`);
  return {
    ...reel,
    beats: reel.beats.map((b) => (b.id === beatId ? { ...b, text: next } : b)),
  };
}
