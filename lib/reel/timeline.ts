import { CaptionCue, Clip, Overlay, Timeline } from './schema';

export function timelineDuration(t: Timeline): number {
  return t.clips.reduce((m, c) => Math.max(m, c.end), 0);
}

/** Half-open [start, end): at an exact cut the later clip wins, so no frame shows two. */
export function clipAt(t: Timeline, time: number): Clip | null {
  return t.clips.find((c) => time >= c.start && time < c.end) ?? null;
}

export function clipProgress(clip: Clip, time: number): number {
  const dur = clip.end - clip.start;
  if (dur <= 0) return 0;
  return Math.min(1, Math.max(0, (time - clip.start) / dur));
}

export function captionsAt(t: Timeline, time: number): CaptionCue[] {
  return t.captions.filter((c) => !c.hidden && time >= c.start && time < c.end);
}

export function overlaysAt(t: Timeline, time: number): Overlay[] {
  return t.overlays.filter((o) => time >= o.start && time < o.end);
}

export function frameAt(t: Timeline, time: number) {
  const clip = clipAt(t, time);
  return {
    clip,
    progress: clip ? clipProgress(clip, time) : 0,
    captions: captionsAt(t, time),
    overlays: overlaysAt(t, time),
  };
}

export function sortTimeline(t: Timeline): Timeline {
  const byStart = <T extends { start: number }>(xs: T[]) => [...xs].sort((a, b) => a.start - b.start);
  return {
    ...t,
    clips: byStart(t.clips),
    captions: byStart(t.captions),
    overlays: byStart(t.overlays),
  };
}
