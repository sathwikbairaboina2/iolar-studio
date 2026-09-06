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

  it('looks ahead: a later unit that still fits is placed, the unfit one spills first', () => {
    const { placed, spill } = packUnits([u(0, 600, 600), u(1, 600, 600), u(2, 600, 600), u(3, 300, 300)], opts);
    expect(placed.map((p: P) => p.unit.index)).toEqual([0, 1, 3]);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([2]);
    expect((placed[2] as P).y).toBe(610);
  });

  it('stops looking ahead after six skipped units so a far block never jumps pages', () => {
    const units = [u(0, 900, 900), ...Array.from({ length: 7 }, (_, i) => u(i + 1, 900, 900)), u(8, 50, 50)];
    const { placed, spill } = packUnits(units, opts);
    expect(placed.map((p: P) => p.unit.index)).toEqual([0, 1]);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('fills the shorter column with upcoming half units before a full-width unit', () => {
    // left 300 tall, right 100 tall; unit 2 is full-width; unit 3 (80) fits the right column's gap.
    const { placed } = packUnits([u(0, 300, 300), u(1, 100, 100), u(2, 60, 60, { forceFull: true }), u(3, 80, 80), u(4, 50, 50)], opts);
    expect(placed.map((p: P) => [p.unit.index, p.span, p.col, p.y])).toEqual([[0, 'half', 0, 0], [1, 'half', 1, 0], [3, 'half', 1, 110], [4, 'half', 1, 200], [2, 'full', 0, 310]]);
    // A heading-bound unit never jumps above the full-width block.
    const bound = packUnits([u(0, 300, 300), u(1, 100, 100), u(2, 60, 60, { forceFull: true }), u(3, 80, 80, { boundIndexes: [3, 4] })], opts);
    expect(bound.placed.map((p: P) => p.unit.index)).toEqual([0, 1, 2, 3]);
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
