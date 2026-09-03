import { mulberry32 } from '../rng';
import { Style } from './styles';
import { Clip, Overlay, Reel, Timeline, Word } from './schema';
import { sortTimeline } from './timeline';
import { alignScriptWords } from './script-align';

export type AssembleInput = { reel: Reel; style: Style };

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
  style: Style,
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
    strength: Math.round(style.motion.strength * gain * (0.8 + rand() * 0.4) * 1e5) / 1e5,
    origin: [0.5, Math.round(originY * 1e5) / 1e5],
  };
}

/** Rebuilds the timeline from beats and words, keeping every locked element byte-identical. */
export function assemble({ reel, style }: AssembleInput): Timeline {
  const rand = mulberry32(reel.seed);
  const spans = beatSpans(reel);
  const ready = new Set(reel.assets.filter((a) => a.status === 'ready').map((a) => a.id));
  const prev = reel.timeline;
  const lockedClips = prev.clips.filter((c) => c.locked);
  const lockedCaptions = prev.captions.filter((c) => c.locked);
  const lockedOverlays = prev.overlays.filter((o) => o.locked);
  const [, maxShot] = style.pacing.shotSec;

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
      // On its own clock, never the cursor's: a recording is cut for a moment in the
      // voiceover, and a neighbour that ran long — padded to the renderer's grid, or
      // breathing out through its tail — must not shove this one off its words. Whatever
      // overlap that leaves is the neighbour's silent surplus, trimmed below.
      const start = r3(whole.takeStart);
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
      cursor = r3(Math.max(cursor, start + whole.durationSec));
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
      const motion = pickMotion(rand, style, isScreen, isStill, p, prevMotion);
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
        transition: style.transitions[clips.length % style.transitions.length],
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
  const inOrder = [...clips].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < inOrder.length; i++) {
    const c = inOrder[i];
    const next = inOrder[i + 1];
    if (c.locked) continue; // a person's edit is verbatim: not held out, not trimmed
    if (!next) {
      c.end = r3(Math.max(c.end, reel.vo.durationSec));
      continue;
    }
    // Both directions meet at the neighbour's start: a short clip is held to it, and one
    // that runs past it gives the surplus up — the overrun is padding, silence and a held
    // frame, and shoving the neighbour late is what put lips out of step.
    c.end = r3(Math.max(next.start, c.start + 0.033));
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
            end: r3(style.hook.durationSec),
            props: { title: hookBeat.text },
            locked: false,
          },
        ]
      : [];

  return sortTimeline({ clips, captions, overlays, music: prev.music });
}
