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

  /**
   * Recordings made for a stretch of the reel, each laid down once.
   *
   * The renderer returns a continuous performance. Cutting it into per-beat pieces, panning
   * across them and re-timing them against a separately cut voiceover threw that away and
   * put the lips out of step with the words — so a recording that knows where it starts goes
   * in whole, from its first frame, for exactly as long as it runs.
   */
  const laid = new Set<string>();

  for (const beat of reel.beats) {
    const span = spans.get(beat.id);
    const assetId = beat.shot.assetId;
    if (!span || !assetId || !ready.has(assetId)) continue;

    const whole = reel.assets.find((a) => a.id === assetId);
    if (whole?.takeStart !== undefined && whole.durationSec) {
      if (laid.has(assetId)) continue;
      laid.add(assetId);
      const start = r3(Math.max(cursor, whole.takeStart));
      clips.push({
        id: `c${clips.length + 1}`,
        assetId,
        beatId: beat.id,
        start,
        end: r3(start + whole.durationSec),
        srcIn: 0,
        fit: 'cover',
        motion: HELD,
        transition: 'cut',
        locked: false,
      });
      cursor = r3(start + whole.durationSec);
      continue;
    }
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
          // Clips butt up against each other, so a clip can begin fractionally before the
          // recording made for it — the beat's own words start later than the silence it
          // inherits from the previous line. Reading from before the file starts is not a
          // thing, so that lands on its opening frame.
          : takeStart !== undefined ? r3(Math.max(0, start + p * each - takeStart))
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

  /**
   * Closes the holes between recordings without moving any of them.
   *
   * A recording is cut for a moment in the voiceover and its lips are in step with the words
   * there, so sliding it to meet its neighbour puts them out. What gives instead is how long
   * the neighbour is held: the export loops its input, so a page that runs four seconds
   * covers six by carrying on scrolling. The last one is held to the end of the voiceover,
   * which is what stops the closing sentence playing over black.
   *
   * Nothing is pulled back to cover the opening. Starting the first recording early would
   * shift it off the words it was cut from, and a face two and a half seconds out of step
   * with its own voice is worse than a moment of black.
   */
  const inOrder = [...clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < inOrder.length; i++) {
    const next = inOrder[i + 1];
    inOrder[i].end = r3(next ? Math.max(inOrder[i].end, next.start) : Math.max(inOrder[i].end, reel.vo.durationSec));
  }

  // No burned-in subtitles. The words are spoken; a second copy of them across the picture
  // is what a caption track is for, and this reel does not want one.
  const captions = lockedCaptions;

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
