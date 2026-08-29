import { mulberry32 } from '../rng';
import { Pattern } from './patterns';
import { CaptionCue, Clip, Overlay, Reel, Timeline, Word } from './schema';
import { sortTimeline } from './timeline';

export type AssembleInput = { reel: Reel; pattern: Pattern };

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

/** Words belong to beats in script order: walk both lists together. */
export function beatSpans(reel: Reel): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>();
  let i = 0;
  for (const beat of reel.beats) {
    const count = beat.text.trim().split(/\s+/).filter(Boolean).length;
    const slice = reel.vo.words.slice(i, i + count);
    i += count;
    if (!slice.length) continue;
    spans.set(beat.id, { start: slice[0].start, end: slice.at(-1)!.end });
  }
  return spans;
}

export function groupCaptions(words: Word[], pattern: Pattern): CaptionCue[] {
  const [, maxW] = pattern.caption.wordsPerBeat;
  const [, maxSec] = pattern.pacing.captionBeatSec;
  const out: CaptionCue[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (!group.length) return;
    out.push({
      id: `k${out.length + 1}`,
      text: group.map((w) => w.w).join(' '),
      start: r3(group[0].start),
      end: r3(group.at(-1)!.end),
      hidden: false,
      locked: false,
    });
    group = [];
  };

  for (const w of words) {
    const candidate = [...group, w];
    const text = candidate.map((x) => x.w).join(' ');
    const span = w.end - candidate[0].start;
    // A word that would burst the pill starts the next caption instead of overflowing it.
    if (group.length && (text.length > pattern.caption.maxChars || span > maxSec)) {
      flush();
      group = [w];
      continue;
    }
    group = candidate;
    if (group.length >= maxW) flush();
  }
  flush();
  return out;
}

function pickMotion(rand: () => number, pattern: Pattern, prev?: Clip['motion']): Clip['motion'] {
  const kinds: Clip['motion']['type'][] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
  const choices = prev ? kinds.filter((k) => k !== prev.type) : kinds;
  const type = choices[Math.floor(rand() * choices.length)];
  const jitter = (rand() - 0.5) * 0.12;
  return {
    type,
    strength: Math.round(pattern.motion.strength * (0.8 + rand() * 0.4) * 1e5) / 1e5,
    origin: [0.5, Math.round((0.45 + jitter) * 1e5) / 1e5],
  };
}

/** Rebuilds the timeline from beats and words, keeping every locked element byte-identical. */
export function assemble({ reel, pattern }: AssembleInput): Timeline {
  const rand = mulberry32(reel.seed);
  const spans = beatSpans(reel);
  const ready = new Set(reel.assets.filter((a) => a.status === 'ready').map((a) => a.id));
  const prev = reel.timeline;
  const lockedClips = prev.clips.filter((c) => c.locked);
  const lockedCaptions = prev.captions.filter((c) => c.locked);
  const lockedOverlays = prev.overlays.filter((o) => o.locked);
  const [, maxShot] = pattern.pacing.shotSec;

  const clips: Clip[] = [];
  let cursor = 0;
  let prevMotion: Clip['motion'] | undefined;

  for (const beat of reel.beats) {
    const span = spans.get(beat.id);
    const assetId = beat.shot.assetId;
    if (!span || !assetId || !ready.has(assetId)) continue;

    const held = lockedClips.filter((c) => c.beatId === beat.id);
    if (held.length) {
      clips.push(...held);
      cursor = Math.max(cursor, ...held.map((c) => c.end));
      continue;
    }

    // Clips butt up against each other: a beat runs from wherever the previous one
    // ended to its own last word, so the pauses between words never show as black.
    const start = cursor;
    const total = Math.max(0.2, span.end - start);
    const pieces = Math.max(1, Math.ceil(total / maxShot));
    const each = total / pieces;
    for (let p = 0; p < pieces; p++) {
      const motion = pickMotion(rand, pattern, prevMotion);
      prevMotion = motion;
      clips.push({
        id: `c${clips.length + 1}`,
        assetId,
        beatId: beat.id,
        start: r3(start + p * each),
        end: r3(start + (p + 1) * each),
        srcIn: r3(p * each),
        fit: beat.shot.kind === 'screen' ? 'contain' : 'cover',
        motion,
        transition: pattern.transitions[clips.length % pattern.transitions.length],
        locked: false,
      });
    }
    cursor = clips.at(-1)!.end;
  }

  const generated = groupCaptions(reel.vo.words, pattern)
    .filter((c) => !lockedCaptions.some((l) => c.start < l.end && l.start < c.end))
    .map((c, i) => ({ ...c, id: `k${lockedCaptions.length + i + 1}` }));
  const captions = [...lockedCaptions, ...generated];

  const hookBeat = reel.beats.find((b) => b.role === 'hook');
  const overlays: Overlay[] = lockedOverlays.length
    ? lockedOverlays
    : hookBeat && reel.vo.words.length
      ? [
          {
            id: 'o1',
            kind: 'hook-title',
            start: 0,
            end: r3(pattern.hook.durationSec),
            props: { title: hookBeat.text },
            locked: false,
          },
        ]
      : [];

  return sortTimeline({ clips, captions, overlays, music: prev.music });
}
