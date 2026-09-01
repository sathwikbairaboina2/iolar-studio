import type { Word } from './schema';

/**
 * Pairs the script against what the recogniser heard.
 *
 * The voiceover is synthesised FROM the script, so the script is the truth about the words
 * and whisper is only ever a witness to when they were said. Walking the two lists in step
 * — one beat's worth of tokens at a time — held only while both agreed on the count. One
 * disagreement ("twenty five" heard as "25") shifted every beat after it onto the wrong
 * words, which shows up as captions and cuts that drift further out of time the longer the
 * reel runs. Aligning the whole script at once instead keeps a local miss local.
 */

/** `heard` marks a word the recogniser actually returned; the rest carry borrowed timings. */
export type AlignedWord = Word & { beatId: string; heard: boolean };
type Beat = { id: string; text: string };

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]+/g, '');

const MATCH = 2;
const MISMATCH = -1;
const GAP = -2;
/** Above this the matrix is not worth building; no script this long reaches the studio. */
const MAX_CELLS = 4_000_000;

type Pair = [number | null, number | null];

/** Needleman-Wunsch over normalised tokens: every script word keeps its place in the result. */
export function alignTokens(script: string[], heard: string[]): Pair[] {
  const n = script.length;
  const m = heard.length;
  if (!n || !m || n * m > MAX_CELLS) {
    // Nothing to align against, or too much to align: fall back to walking in step.
    const pairs: Pair[] = [];
    for (let i = 0; i < Math.max(n, m); i++) pairs.push([i < n ? i : null, i < m ? i : null]);
    return pairs;
  }

  const a = script.map(norm);
  const b = heard.map(norm);
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i++) score[i * width] = i * GAP;
  for (let j = 1; j <= m; j++) score[j] = j * GAP;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[(i - 1) * width + (j - 1)] + (a[i - 1] === b[j - 1] ? MATCH : MISMATCH);
      const up = score[(i - 1) * width + j] + GAP;
      const left = score[i * width + (j - 1)] + GAP;
      score[i * width + j] = Math.max(diag, up, left);
    }
  }

  const pairs: Pair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const diag = score[(i - 1) * width + (j - 1)] + (a[i - 1] === b[j - 1] ? MATCH : MISMATCH);
      if (score[i * width + j] === diag) {
        pairs.push([i - 1, j - 1]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && score[i * width + j] === score[(i - 1) * width + j] + GAP) {
      pairs.push([i - 1, null]);
      i--;
      continue;
    }
    pairs.push([null, j - 1]);
    j--;
  }
  return pairs.reverse();
}

/** Script tokens, flattened, each remembering the beat it came from. */
function scriptTokens(beats: Beat[]): { w: string; beatId: string }[] {
  return beats.flatMap((b) =>
    b.text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ w, beatId: b.id }))
  );
}

/**
 * The script's words carrying the recogniser's timings.
 *
 * A word the recogniser missed is still a word that was spoken: it keeps its place and is
 * given the time between its neighbours, weighted by length. A word the recogniser invented
 * mid-script is dropped — captioning it would put text on screen the script never said —
 * but anything heard past the end of the script is kept, since that is narration nothing
 * else will caption.
 */
export function alignScriptWords(beats: Beat[], heard: Word[]): AlignedWord[] {
  const tokens = scriptTokens(beats);
  if (!heard.length) return [];
  if (!tokens.length) {
    return heard.map((w) => ({ ...w, beatId: beats.at(-1)?.id ?? '', heard: true }));
  }

  const pairs = alignTokens(
    tokens.map((t) => t.w),
    heard.map((w) => w.w)
  );
  const lastScriptPair = pairs.reduce((last, p, idx) => (p[0] !== null ? idx : last), -1);

  type Slot = { w: string; beatId: string; start?: number; end?: number };
  const slots: Slot[] = [];
  const heardAt: boolean[] = [];
  pairs.forEach(([s, h], idx) => {
    if (s !== null && h !== null) {
      slots.push({ w: tokens[s].w, beatId: tokens[s].beatId, start: heard[h].start, end: heard[h].end });
      heardAt.push(true);
      return;
    }
    if (s !== null) {
      slots.push({ w: tokens[s].w, beatId: tokens[s].beatId });
      heardAt.push(false);
      return;
    }
    // Heard, but not in the script.
    if (h !== null && idx > lastScriptPair) {
      slots.push({ w: heard[h].w, beatId: tokens.at(-1)!.beatId, start: heard[h].start, end: heard[h].end });
      heardAt.push(true);
    }
  });

  fillGaps(slots);
  return slots.map((s, i) => ({
    w: s.w,
    start: r3(s.start ?? 0),
    end: r3(Math.max(s.end ?? 0, (s.start ?? 0) + 0.01)),
    beatId: s.beatId,
    heard: heardAt[i],
  }));
}

const r3 = (n: number) => Math.round(n * 1e3) / 1e3;
/** What an unheard word is worth when there is no gap to share out. */
const NOMINAL_WORD_SEC = 0.24;

/** Gives every word the recogniser missed a slice of the silence around it. */
function fillGaps(slots: { w: string; start?: number; end?: number }[]): void {
  const timed = slots.map((s, i) => (s.start === undefined ? -1 : i)).filter((i) => i >= 0);
  if (!timed.length) {
    // Nothing was heard at all: lay the words out end to end so cues stay in order.
    slots.forEach((s, i) => {
      s.start = i * NOMINAL_WORD_SEC;
      s.end = s.start + NOMINAL_WORD_SEC;
    });
    return;
  }

  const share = (from: number, to: number, at: number, until: number) => {
    const run = slots.slice(from, to);
    const weights = run.map((s) => Math.max(1, s.w.length));
    const total = weights.reduce((a, b) => a + b, 0);
    const room = Math.max(until - at, run.length * 0.01);
    let cursor = at;
    run.forEach((s, i) => {
      const span = (room * weights[i]) / total;
      s.start = cursor;
      s.end = cursor + span;
      cursor = s.end;
    });
  };

  const first = timed[0];
  if (first > 0) {
    const room = first * NOMINAL_WORD_SEC;
    share(0, first, Math.max(0, slots[first].start! - room), slots[first].start!);
  }
  for (let k = 1; k < timed.length; k++) {
    const prev = timed[k - 1];
    const next = timed[k];
    if (next - prev > 1) share(prev + 1, next, slots[prev].end!, slots[next].start!);
  }
  const last = timed.at(-1)!;
  if (last < slots.length - 1) {
    const room = (slots.length - 1 - last) * NOMINAL_WORD_SEC;
    share(last + 1, slots.length, slots[last].end!, slots[last].end! + room);
  }
}
