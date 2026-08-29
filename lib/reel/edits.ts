import { CaptionCue, Clip, Reel, Timeline } from './schema';
import { sortTimeline } from './timeline';

/**
 * Every studio edit lives here as a pure function of the reel.
 *
 * Two rules hold across all of them: a touched element is marked `locked` so
 * re-assembly leaves it alone, and clips stay contiguous so the export never
 * shows a hole where a clip used to be.
 */

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;
const MIN_CLIP = 0.2;

function withTimeline(reel: Reel, timeline: Timeline): Reel {
  return { ...reel, timeline: sortTimeline(timeline) };
}

/** Closes gaps left by a trim or a delete, preserving each clip's own length. */
export function reflow(clips: Clip[]): Clip[] {
  let cursor = 0;
  return clips.map((c) => {
    const dur = c.end - c.start;
    const next = { ...c, start: r3(cursor), end: r3(cursor + dur) };
    cursor = next.end;
    return next;
  });
}

export function trimClip(reel: Reel, clipId: string, edge: 'in' | 'out', deltaSec: number): Reel {
  const clips = reel.timeline.clips.map((c) => {
    if (c.id !== clipId) return c;
    if (edge === 'in') {
      const start = Math.min(c.end - MIN_CLIP, c.start + deltaSec);
      return { ...c, start: r3(start), srcIn: r3(Math.max(0, c.srcIn + (start - c.start))), locked: true };
    }
    return { ...c, end: r3(Math.max(c.start + MIN_CLIP, c.end + deltaSec)), locked: true };
  });
  return withTimeline(reel, { ...reel.timeline, clips: reflow(clips) });
}

export function splitClip(reel: Reel, clipId: string, atSec: number): Reel {
  const target = reel.timeline.clips.find((c) => c.id === clipId);
  if (!target) return reel;
  if (atSec <= target.start + MIN_CLIP || atSec >= target.end - MIN_CLIP) return reel;

  const offset = atSec - target.start;
  const left: Clip = { ...target, end: r3(atSec), locked: true };
  const right: Clip = {
    ...target,
    id: `${target.id}-b`,
    start: r3(atSec),
    srcIn: r3(target.srcIn + offset),
    locked: true,
  };
  const clips = reel.timeline.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c]));
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function deleteClip(reel: Reel, clipId: string): Reel {
  const clips = reflow(reel.timeline.clips.filter((c) => c.id !== clipId)).map((c) => ({ ...c, locked: true }));
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function moveClip(reel: Reel, clipId: string, toIndex: number): Reel {
  const clips = [...reel.timeline.clips];
  const from = clips.findIndex((c) => c.id === clipId);
  if (from < 0 || toIndex < 0 || toIndex >= clips.length) return reel;
  const [moved] = clips.splice(from, 1);
  clips.splice(toIndex, 0, moved);
  return withTimeline(reel, {
    ...reel.timeline,
    clips: reflow(clips).map((c) => ({ ...c, locked: true })),
  });
}

export function setClipMotion(reel: Reel, clipId: string, motion: Partial<Clip['motion']>): Reel {
  const clips = reel.timeline.clips.map((c) =>
    c.id === clipId ? { ...c, motion: { ...c.motion, ...motion }, locked: true } : c
  );
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function setClipFit(reel: Reel, clipId: string, fit: Clip['fit']): Reel {
  const clips = reel.timeline.clips.map((c) => (c.id === clipId ? { ...c, fit, locked: true } : c));
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function setClipTransition(reel: Reel, clipId: string, transition: Clip['transition']): Reel {
  const clips = reel.timeline.clips.map((c) => (c.id === clipId ? { ...c, transition, locked: true } : c));
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function replaceClipAsset(reel: Reel, clipId: string, assetId: string): Reel {
  const clips = reel.timeline.clips.map((c) => (c.id === clipId ? { ...c, assetId, locked: true } : c));
  return withTimeline(reel, { ...reel.timeline, clips });
}

export function editCaption(reel: Reel, cueId: string, text: string): Reel {
  const captions = reel.timeline.captions.map((c) => (c.id === cueId ? { ...c, text, locked: true } : c));
  return withTimeline(reel, { ...reel.timeline, captions });
}

export function nudgeCaption(reel: Reel, cueId: string, deltaSec: number): Reel {
  const captions = reel.timeline.captions.map((c) =>
    c.id === cueId
      ? { ...c, start: r3(Math.max(0, c.start + deltaSec)), end: r3(Math.max(0.05, c.end + deltaSec)), locked: true }
      : c
  );
  return withTimeline(reel, { ...reel.timeline, captions });
}

export function toggleCaption(reel: Reel, cueId: string): Reel {
  const captions = reel.timeline.captions.map((c) =>
    c.id === cueId ? { ...c, hidden: !c.hidden, locked: true } : c
  );
  return withTimeline(reel, { ...reel.timeline, captions });
}

/** Merges a caption with the one after it, so two beats read as one line. */
export function mergeCaption(reel: Reel, cueId: string): Reel {
  const cues = [...reel.timeline.captions].sort((a, b) => a.start - b.start);
  const i = cues.findIndex((c) => c.id === cueId);
  if (i < 0 || i + 1 >= cues.length) return reel;
  const merged: CaptionCue = {
    ...cues[i],
    text: `${cues[i].text} ${cues[i + 1].text}`.trim(),
    end: cues[i + 1].end,
    locked: true,
  };
  const captions = [...cues.slice(0, i), merged, ...cues.slice(i + 2)];
  return withTimeline(reel, { ...reel.timeline, captions });
}

/** Splits a caption in two at the word boundary nearest the middle. */
export function splitCaption(reel: Reel, cueId: string): Reel {
  const cue = reel.timeline.captions.find((c) => c.id === cueId);
  if (!cue) return reel;
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return reel;
  const half = Math.ceil(words.length / 2);
  const mid = r3(cue.start + (cue.end - cue.start) * (half / words.length));
  const first: CaptionCue = { ...cue, text: words.slice(0, half).join(' '), end: mid, locked: true };
  const second: CaptionCue = {
    ...cue,
    id: `${cue.id}-b`,
    text: words.slice(half).join(' '),
    start: mid,
    locked: true,
  };
  const captions = reel.timeline.captions.flatMap((c) => (c.id === cueId ? [first, second] : [c]));
  return withTimeline(reel, { ...reel.timeline, captions });
}
