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

/** A caption still has to be readable, and the schema rejects a zero-length cue.
 *  Whisper does emit words whose start equals their end, usually at the very end of a take. */
export const MIN_CUE_SEC = 0.12;

/**
 * The script's own words, carrying the timings the recogniser found.
 *
 * Captions must read like the script, not like a transcript: the voiceover was synthesised
 * FROM the script, so whisper's text is only ever a lossy round trip of it — it heard
 * "Rock Bot" for "Grok Bot". Timings are all we want from it. Word counts are compared per
 * beat, and a beat whose counts disagree keeps the recogniser's text rather than risk
 * pairing the wrong word with the wrong moment.
 */
export function scriptAlignedWords(reel: Reel): Word[] {
  const out: Word[] = [];
  let i = 0;
  for (const beat of reel.beats) {
    const tokens = beat.text.trim().split(/\s+/).filter(Boolean);
    const heard = reel.vo.words.slice(i, i + tokens.length);
    i += tokens.length;
    if (!heard.length) continue;
    out.push(
      ...(heard.length === tokens.length
        ? heard.map((w, n) => ({ ...w, w: tokens[n] }))
        : heard)
    );
  }
  // Anything the recogniser found past the end of the script still needs to be captioned.
  return [...out, ...reel.vo.words.slice(i)];
}

export function groupCaptions(words: Word[], pattern: Pattern): CaptionCue[] {
  const [, maxW] = pattern.caption.wordsPerBeat;
  const [, maxSec] = pattern.pacing.captionBeatSec;
  const out: CaptionCue[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const end = Math.max(group.at(-1)!.end, start + MIN_CUE_SEC);
    out.push({
      id: `k${out.length + 1}`,
      text: group.map((w) => w.w).join(' '),
      start: r3(start),
      end: r3(end),
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

/**
 * Camera motion is compensation for a still.
 *
 * Footage that already moves — a recorded scene, a generated clip — is composed to fill the
 * frame, and panning across it only crops the edges off: a recorded UI came back with its
 * own headings sliced in half. Video is held; only stills get a move.
 */
const SCREEN_MOTIONS: Clip['motion']['type'][] = ['pan-up', 'pan-down'];
const FOOTAGE_MOTIONS: Clip['motion']['type'][] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
export const SCREEN_MOTION_GAIN = 2.2;

/**
 * A long beat is split across several clips of the same footage. Left alone those pieces
 * look like one unbroken shot, so each piece is framed on a different part of the picture:
 * the join then reads as a cut to somewhere else rather than a seam nobody notices.
 */
const PIECE_ORIGINS = [0.32, 0.68, 0.5, 0.8];

export const HELD: Clip['motion'] = { type: 'hold', strength: 0, origin: [0.5, 0.5] };

function pickMotion(
  rand: () => number,
  pattern: Pattern,
  isScreen: boolean,
  isStill: boolean,
  piece: number,
  prev?: Clip['motion']
): Clip['motion'] {
  if (!isStill) return HELD;
  const kinds = isScreen ? SCREEN_MOTIONS : FOOTAGE_MOTIONS;
  const choices = kinds.length > 1 && prev ? kinds.filter((k) => k !== prev.type) : kinds;
  const type = choices[Math.floor(rand() * choices.length)] ?? kinds[0];
  const jitter = (rand() - 0.5) * 0.12;
  const gain = isScreen ? SCREEN_MOTION_GAIN : 1;
  const originY = piece === 0 ? 0.45 + jitter : PIECE_ORIGINS[(piece - 1) % PIECE_ORIGINS.length];
  return {
    type,
    strength: Math.round(pattern.motion.strength * gain * (0.8 + rand() * 0.4) * 1e5) / 1e5,
    origin: [0.5, Math.round(originY * 1e5) / 1e5],
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
    const isScreen = beat.shot.kind === 'screen';
    const isStill = reel.assets.find((a) => a.id === assetId)?.kind === 'image';
    for (let p = 0; p < pieces; p++) {
      const motion = pickMotion(rand, pattern, isScreen, isStill, p, prevMotion);
      prevMotion = motion;
      clips.push({
        id: `c${clips.length + 1}`,
        assetId,
        beatId: beat.id,
        start: r3(start + p * each),
        end: r3(start + (p + 1) * each),
        srcIn: r3(p * each),
        fit: 'cover',
        motion,
        transition: pattern.transitions[clips.length % pattern.transitions.length],
        locked: false,
      });
    }
    cursor = clips.at(-1)!.end;
  }

  const generated = groupCaptions(scriptAlignedWords(reel), pattern)
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
