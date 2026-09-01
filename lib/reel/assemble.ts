import { mulberry32 } from '../rng';
import { Pattern } from './patterns';
import { CaptionCue, Clip, Overlay, Reel, Timeline, Word } from './schema';
import { sortTimeline } from './timeline';
import { alignScriptWords } from './script-align';

export type AssembleInput = { reel: Reel; pattern: Pattern };

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

/**
 * A beat runs from its first aligned word to its last.
 *
 * A beat the recogniser returned nothing for gets no span at all: its words carry borrowed
 * timings, good enough to caption but not to cut audio or footage against — a slice taken
 * there is silence with a mouth moving over it.
 */
export function beatSpans(reel: Reel): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>();
  const anyHeard = new Set<string>();
  for (const w of alignScriptWords(reel.beats, reel.vo.words)) {
    if (w.heard) anyHeard.add(w.beatId);
    const span = spans.get(w.beatId);
    spans.set(w.beatId, span ? { start: span.start, end: Math.max(span.end, w.end) } : { start: w.start, end: w.end });
  }
  for (const id of spans.keys()) if (!anyHeard.has(id)) spans.delete(id);
  return spans;
}

/** A caption still has to be readable, and the schema rejects a zero-length cue.
 *  Whisper does emit words whose start equals their end, usually at the very end of a take. */
export const MIN_CUE_SEC = 0.12;

/** The script's own words, carrying the timings the recogniser found. See `script-align.ts`. */
export function scriptAlignedWords(reel: Reel): Word[] {
  return alignScriptWords(reel.beats, reel.vo.words);
}

const ORPHAN_SPAN_RELAX = 1.6;

/** A cue that ends here is a cue a reader would end: the sentence is over. */
const ENDS_SENTENCE = /[.!?…]["'”’)\]]?$/;

export function groupCaptions(words: Word[], pattern: Pattern): CaptionCue[] {
  const [, maxW] = pattern.caption.wordsPerBeat;
  const [, maxSec] = pattern.pacing.captionBeatSec;
  const out: { words: Word[] }[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (!group.length) return;
    out.push({ words: group });
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
    } else {
      group = candidate;
    }
    // Reading "practice. A" as one cue and "suggestion. Nobody" as the next puts the break
    // in the middle of a thought every time. Break where the sentence does instead.
    if (ENDS_SENTENCE.test(w.w) || group.length >= maxW) flush();
  }
  flush();

  return rebalance(out, pattern).map((g, i) => {
    const start = g.words[0].start;
    const end = Math.max(g.words.at(-1)!.end, start + MIN_CUE_SEC);
    return {
      id: `k${i + 1}`,
      text: g.words.map((w) => w.w).join(' '),
      start: r3(start),
      end: r3(end),
      hidden: false,
      locked: false,
    };
  });
}

/**
 * Pulls a stranded word back into the cue before it.
 *
 * A char cap that trips one word early leaves that word alone on screen for a fifth of a
 * second — the flicker that reads as the captions breaking up. Merging is refused when it
 * would burst the pill, outrun the cue clock, or paste across a full stop.
 */
function rebalance(groups: { words: Word[] }[], pattern: Pattern): { words: Word[] }[] {
  const [, maxW] = pattern.caption.wordsPerBeat;
  const [, maxSec] = pattern.pacing.captionBeatSec;
  const chars = (ws: Word[]) => ws.map((w) => w.w).join(' ').length;
  const span = (ws: Word[]) => ws.at(-1)!.end - ws[0].start;
  const joinable = (ws: Word[], limit: number) =>
    ws.length <= maxW && chars(ws) <= pattern.caption.maxChars && span(ws) <= limit;

  const out: { words: Word[] }[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prev = out.at(-1);
    const alone = g.words.length === 1;
    if (alone && prev && !ENDS_SENTENCE.test(prev.words.at(-1)!.w) && joinable([...prev.words, ...g.words], maxSec)) {
      out[out.length - 1] = { words: [...prev.words, ...g.words] };
      continue;
    }
    // Nowhere to put it behind: take the next cue's words instead. A word alone on screen for
    // a fifth of a second reads as a flicker, which is worse than a cue that runs slightly long.
    const next = groups[i + 1];
    if (
      alone &&
      next &&
      !ENDS_SENTENCE.test(g.words[0].w) &&
      joinable([...g.words, ...next.words], maxSec * ORPHAN_SPAN_RELAX)
    ) {
      out.push({ words: [...g.words, ...next.words] });
      i++;
      continue;
    }
    out.push(g);
  }
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
    // the footage this line can cut between, primary first
    const pool = [assetId, ...beat.shot.alsoAssetIds].filter((id) => ready.has(id));

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
    // One continuous take runs to the same clock as the reel, so a clip at 2.4s shows
    // second 2.4 of it. Anything else replays the opening under every line.
    const covering = reel.assets.find((a) => a.id === pool[0]);
    const fromTake = covering?.fullTake === true;
    // Footage that covers several beats starts somewhere on the reel's clock; a clip inside
    // it shows the part that matches when it plays, not the top of the recording again.
    const takeStart = covering?.takeStart;
    for (let p = 0; p < pieces; p++) {
      const pieceAsset = pool[p % pool.length];
      const isStill = reel.assets.find((a) => a.id === pieceAsset)?.kind === 'image';
      const motion = pickMotion(rand, pattern, isScreen, isStill, p, prevMotion);
      prevMotion = motion;
      clips.push({
        id: `c${clips.length + 1}`,
        assetId: pieceAsset,
        beatId: beat.id,
        start: r3(start + p * each),
        end: r3(start + (p + 1) * each),
        // a piece on its own footage starts at the top of it; only pieces reusing the
        // previous shot continue through it
        srcIn:
          fromTake ? r3(start + p * each)
          : takeStart !== undefined ? r3(start + p * each - takeStart)
          : pool.length > 1 ? 0
          : r3(p * each),
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
