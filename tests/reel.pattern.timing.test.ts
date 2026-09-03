import { describe, it, expect } from 'vitest';
import { lineSpans, unitTimes, defaultTimes, UnitTooLong } from '@/lib/reel/pattern/timing';
import { script } from './reel.pattern.tools.test';
import type { Unit } from '@/lib/reel/pattern/types';

/** Words for the whole script, one every 0.4 s from t=0.5, in script order. */
function heard() {
  const words: { w: string; start: number; end: number }[] = [];
  let t = 0.5;
  for (const l of [...script.lines].sort((a, b) => a.order - b.order)) {
    for (const w of l.text.split(/\s+/)) {
      words.push({ w, start: t, end: t + 0.3 });
      t += 0.4;
    }
    t += 0.4; // a breath between lines
  }
  return words;
}
const units: Unit[] = [
  { path: 'sections.0', label: 'hook', kind: 'hook', lineIds: ['l1'] },
  { path: 'sections.1.slides.0', label: 'slide 1', kind: 'slide', lineIds: ['l2'] },
  { path: 'sections.1.slides.1', label: 'slide 2', kind: 'slide', lineIds: ['l3'] },
  { path: 'sections.2.pages.0', label: 'page 1', kind: 'page', lineIds: ['l4'] },
  { path: 'sections.3', label: 'cta', kind: 'cta', lineIds: ['l5'] },
];
const opts = { fps: 30, secMin: 1, secMax: 30, leadSec: 0.25 };

describe('lineSpans', () => {
  it('gives every line the span of its heard words, in order', () => {
    const spans = lineSpans(script, heard());
    expect([...spans.keys()]).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(spans.get('l1')!.start).toBeCloseTo(0.5, 2);
    expect(spans.get('l2')!.start).toBeGreaterThan(spans.get('l1')!.end);
  });
  it('returns nothing for a reel with no words yet', () => {
    expect(lineSpans(script, []).size).toBe(0);
  });
});

describe('unitTimes', () => {
  it('starts each unit a lead before its first word, the first at zero, the last at the voice end', () => {
    const spans = lineSpans(script, heard());
    const voSec = 20;
    const t = unitTimes(units, spans, voSec, opts);
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBeCloseTo(spans.get('l2')!.start - 0.25, 1);
    expect(t[4].end).toBe(voSec);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeCloseTo(t[i - 1].end, 3);
    for (const u of t) {
      expect(u.sec).toBeCloseTo(u.end - u.start, 3);
      if (u !== t[4]) expect(Math.round(u.end * 30)).toBeCloseTo(u.end * 30, 6);
    }
  });
  it('never lets a unit go under secMin, pushing the boundary forward', () => {
    const spans = new Map([
      ['l1', { start: 0.2, end: 0.5 }], ['l2', { start: 0.6, end: 1 }], ['l3', { start: 1.1, end: 2 }],
      ['l4', { start: 2.1, end: 3 }], ['l5', { start: 3.1, end: 4 }],
    ]);
    const t = unitTimes(units, spans, 12, opts);
    for (const u of t) expect(u.sec).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(t.at(-1)!.end).toBe(12);
  });
  it('names a unit that would run past secMax instead of trimming it', () => {
    const spans = lineSpans(script, heard());
    expect(() => unitTimes(units, spans, 200, { ...opts, secMax: 30 })).toThrow(UnitTooLong);
    try {
      unitTimes(units, spans, 200, { ...opts, secMax: 30 });
    } catch (e) {
      expect((e as UnitTooLong).unit.label).toBe('cta');
      expect((e as UnitTooLong).message).toMatch(/cta.*30/);
    }
  });
  it('falls back to a line share when a line was never heard', () => {
    const spans = lineSpans(script, heard());
    spans.delete('l3');
    const t = unitTimes(units, spans, 20, opts);
    expect(t[2].sec).toBeGreaterThanOrEqual(1);
    expect(t[2].start).toBeGreaterThan(t[1].start);
  });
});

describe('defaultTimes', () => {
  it('uses the template defaults per kind, frame-rounded, back to back', () => {
    const t = defaultTimes(units, { hook: 10, slide: 6, page: 4, cta: 5 }, { fps: 30 });
    expect(t.map((u) => u.sec)).toEqual([10, 6, 6, 4, 5]);
    expect(t.at(-1)!.end).toBe(31);
  });
});
