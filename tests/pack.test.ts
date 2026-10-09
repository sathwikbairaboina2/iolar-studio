import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require_ = createRequire(import.meta.url);
const { packUnits } = require_(path.join(process.cwd(), 'templates/_shared/pack.js'));

const u = (index: number, fullH: number, halfH: number, extra: object = {}) =>
  ({ index, type: 'bullets', boundIndexes: [index], fullH, halfH, ...extra });
const opts = { columns: 2, pageHeight: 1000, rowGap: 10 };
type P = { unit: { index: number }; span: string; col: number; y: number; height: number };

describe('packUnits (column flow)', () => {
  it('drops half-width units into alternating columns at the top', () => {
    const { placed, spill } = packUnits([u(0, 100, 100), u(1, 100, 100)], opts);
    expect(spill).toEqual([]);
    expect(placed.map((p: P) => [p.col, p.y])).toEqual([[0, 0], [1, 0]]);
  });

  it('always fills the shorter column next, so a short block beside a tall one wastes nothing', () => {
    const { placed, usedPx } = packUnits([u(0, 300, 300), u(1, 100, 100), u(2, 100, 100), u(3, 100, 100)], opts);
    // unit 1 goes right (0), unit 2 goes right again (110) because left is at 300, unit 3 right (220).
    expect(placed.map((p: P) => [p.unit.index, p.col, p.y])).toEqual([[0, 0, 0], [1, 1, 0], [2, 1, 110], [3, 1, 220]]);
    expect(usedPx).toBe(320);
  });

  it('a full-width unit closes both columns and starts below the taller one', () => {
    const { placed } = packUnits([u(0, 200, 200), u(1, 80, 80), u(2, 60, 60, { forceFull: true }), u(3, 50, 50, { boundIndexes: [3, 4] })], opts);
    const full = placed[2] as P;
    expect(full.span).toBe('full');
    expect(full.y).toBe(210);
    expect((placed[3] as P).y).toBe(280);
    expect((placed[3] as P).col).toBe(0);
  });

  it('forces full width only when squeezing more than doubles the height', () => {
    expect((packUnits([u(0, 100, 250)], opts).placed[0] as P).span).toBe('full');
    // Prose roughly 1.7x when halved — still a win on area, so it stays half.
    const prose = packUnits([u(0, 100, 170), u(1, 100, 170)], opts);
    expect(prose.placed.map((p: P) => p.span)).toEqual(['half', 'half']);
  });

  it('spills the first unit that does not fit and everything after it, in order', () => {
    const units = [u(0, 400, 400), u(1, 400, 400), u(2, 400, 400), u(3, 400, 400)];
    const ok = packUnits(units, { columns: 2, pageHeight: 900, rowGap: 10 });
    expect(ok.spill).toEqual([]);
    expect(ok.usedPx).toBe(810);

    const tight = packUnits(
      [u(0, 500, 500, { forceFull: true }), u(1, 500, 500, { forceFull: true }), u(2, 500, 500, { forceFull: true })],
      { columns: 2, pageHeight: 1020, rowGap: 10 }
    );
    expect(tight.spill.map((s: { index: number }) => s.index)).toEqual([2]);

    const later = packUnits([u(0, 600, 600), u(1, 600, 600), u(2, 600, 600), u(3, 600, 600)], opts);
    expect(later.spill.map((s: { index: number }) => s.index)).toEqual([2, 3]);
  });

  it('keeps authored order across pages: nothing after the first unit that does not fit is placed', () => {
    // Q33 (index 2) does not fit; the small Q34 (index 3) would, and used to be printed on this
    // page while Q33 was pushed to the next one: Q34 before Q33.
    const { placed, spill } = packUnits([u(0, 600, 600), u(1, 600, 600), u(2, 600, 600), u(3, 300, 300)], opts);
    expect(placed.map((p: P) => p.unit.index)).toEqual([0, 1]);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([2, 3]);
  });

  it('never places a unit after one that spilled, however small it is', () => {
    const units = [u(0, 900, 900), ...Array.from({ length: 7 }, (_, i) => u(i + 1, 900, 900)), u(8, 50, 50)];
    const { placed, spill } = packUnits(units, opts);
    expect(placed.map((p: P) => p.unit.index)).toEqual([0, 1]);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('a numbered sequence stays in order on both sides of the page break, whatever the heights', () => {
    // Questions 33..40 with mixed heights, most of them small enough to slip into a gap.
    const heights = [380, 430, 520, 120, 90, 480, 60, 410];
    const units = heights.map((h, i) => u(i, h, h, { number: 33 + i }));
    const { placed, spill } = packUnits(units, opts);
    const order = [...placed.map((p: P) => p.unit.index), ...spill.map((s: { index: number }) => s.index)];
    expect(order).toEqual(units.map((x) => x.index));
    const lastPlaced = Math.max(...placed.map((p: P) => p.unit.index));
    expect(Math.min(...spill.map((s: { index: number }) => s.index))).toBeGreaterThan(lastPlaced);
  });

  it('a full-width unit does not let later units jump above it into the shorter column', () => {
    // left 300 tall, right 100 tall; unit 2 is full-width. Unit 3 would fit the right column's
    // gap but comes after unit 2 in the authored order, so it stays below it.
    const { placed } = packUnits([u(0, 300, 300), u(1, 100, 100), u(2, 60, 60, { forceFull: true }), u(3, 80, 80), u(4, 50, 50)], opts);
    expect(placed.map((p: P) => [p.unit.index, p.span, p.col, p.y])).toEqual([[0, 'half', 0, 0], [1, 'half', 1, 0], [2, 'full', 0, 310], [3, 'half', 0, 380], [4, 'half', 1, 380]]);
  });

  it('never spills the very first unit, even one taller than the page', () => {
    const { placed, spill } = packUnits([u(0, 5000, 5000)], opts);
    expect(placed.length).toBe(1);
    expect(spill).toEqual([]);
  });

  it('is deterministic for identical input', () => {
    const units = [u(0, 120, 200), u(1, 90, 90), u(2, 300, 300, { forceFull: true }), u(3, 90, 90)];
    expect(JSON.stringify(packUnits(units, opts))).toBe(JSON.stringify(packUnits(units, opts)));
  });
});
