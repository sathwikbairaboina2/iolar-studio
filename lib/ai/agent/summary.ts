import type { Reel } from '@/lib/reel/schema';

/**
 * What the model is shown of the reel.
 *
 * A whole reel carries word-level voiceover timings and per-asset metadata that
 * an editing decision never needs, and an 8B model's context is better spent on
 * the timeline itself. Only ids, times and text go in — enough to reason about
 * what to change and to name the thing being changed.
 */
export function reelSummary(reel: Reel) {
  return {
    title: reel.title,
    durationSec: reel.vo?.durationSec ?? 0,
    clips: reel.timeline.clips.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      lengthSec: Math.round((c.end - c.start) * 1000) / 1000,
      motion: c.motion.type,
      fit: c.fit,
      transition: c.transition,
      assetId: c.assetId,
    })),
    captions: reel.timeline.captions.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      text: c.text,
      hidden: c.hidden ?? false,
    })),
    assets: reel.assets.map((a) => ({ id: a.id, kind: a.kind, status: a.status })),
  };
}
