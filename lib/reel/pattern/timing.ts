import { alignScriptWords } from '../script-align';
import type { Script } from '../research/script';
import type { Word } from '../schema';
import type { Unit, UnitTime } from './types';

/**
 * The voice is the timing authority. A unit begins a breath before its first line is
 * heard and ends where the next begins; nothing stretches to a floor beyond secMin,
 * because nothing can move the words. Unit boundaries are line boundaries, so a sentence
 * is never cut. `sec` is computed here every time and never stored.
 */

export type Span = { start: number; end: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Where each script line was heard, from the words whisper aligned to the script. */
export function lineSpans(script: Script, words: Word[]): Map<string, Span> {
  const lines = [...script.lines].sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, text: l.text }));
  const spans = new Map<string, Span>();
  const heard = new Set<string>();
  for (const w of alignScriptWords(lines, words)) {
    if (w.heard) heard.add(w.beatId);
    const s = spans.get(w.beatId);
    spans.set(w.beatId, s ? { start: s.start, end: Math.max(s.end, w.end) } : { start: w.start, end: w.end });
  }
  for (const id of [...spans.keys()]) if (!heard.has(id)) spans.delete(id);
  return spans;
}

export class UnitTooLong extends Error {
  constructor(public readonly unit: Unit, public readonly sec: number, public readonly limit: number) {
    super(`${unit.label} needs ${sec.toFixed(1)} s, the template allows ${limit} s; split it or move a line`);
    this.name = 'UnitTooLong';
  }
}

export type TimingOpts = { fps: number; secMin: number; secMax: number; leadSec?: number };

export function unitTimes(units: Unit[], spans: Map<string, Span>, voSec: number, opts: TimingOpts): UnitTime[] {
  if (units.length === 0) return [];
  const lead = opts.leadSec ?? 0.25;
  const grid = (n: number) => Math.round(n * opts.fps) / opts.fps;

  // Where each unit's speech begins: its first heard line, else a share of the reel by lines.
  const totalLines = units.reduce((s, u) => s + u.lineIds.length, 0) || 1;
  let before = 0;
  const starts = units.map((u) => {
    const share = round3((voSec * before) / totalLines);
    before += u.lineIds.length;
    const first = u.lineIds.map((id) => spans.get(id)).find((s): s is Span => Boolean(s));
    return first ? first.start : share;
  });
  for (let k = 1; k < starts.length; k++) if (starts[k] < starts[k - 1]) starts[k] = starts[k - 1];

  const out: UnitTime[] = [];
  let cursor = 0;
  units.forEach((u, k) => {
    const last = k === units.length - 1;
    // Boundaries sit on the frame grid and are kept as the grid gives them: rounding them
    // to milliseconds would put a cut a fraction of a frame off the picture.
    let end = last ? voSec : starts[k + 1] - lead;
    if (end < cursor + opts.secMin) end = cursor + opts.secMin;
    end = last ? voSec : grid(end);
    if (last && end < cursor + opts.secMin) end = grid(cursor + opts.secMin);
    const sec = round3(end - cursor);
    if (sec > opts.secMax + 1e-6) throw new UnitTooLong(u, sec, opts.secMax);
    out.push({ ...u, start: cursor, end, sec });
    cursor = end;
  });
  return out;
}

/** Before the voice exists: the template's defaults per kind, so the layout can be previewed. */
export function defaultTimes(units: Unit[], defaults: Record<string, number>, opts: { fps: number }): UnitTime[] {
  const grid = (n: number) => Math.round(n * opts.fps) / opts.fps;
  let cursor = 0;
  return units.map((u) => {
    const sec = grid(defaults[u.kind] ?? 5);
    const t = { ...u, start: round3(cursor), end: round3(cursor + sec), sec: round3(sec) };
    cursor = round3(cursor + sec);
    return t;
  });
}
