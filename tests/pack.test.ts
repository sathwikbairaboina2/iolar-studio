import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require_ = createRequire(import.meta.url);
const { packUnits } = require_(path.join(process.cwd(), 'templates/_shared/pack.js'));

const u = (index: number, fullH: number, halfH: number, extra: object = {}) =>
  ({ index, type: 'bullets', boundIndexes: [index], fullH, halfH, ...extra });

describe('packUnits', () => {
  it('pairs two half-width units into one row', () => {
    const { rows, spill } = packUnits([u(0, 100, 100), u(1, 100, 100)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(spill).toEqual([]);
    expect(rows.length).toBe(1);
    expect(rows[0].items.map((i: { col: number }) => i.col)).toEqual([0, 1]);
  });

  it('forces full width when forceFull is set', () => {
    const { rows } = packUnits([u(0, 80, 80, { forceFull: true }), u(1, 80, 80)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items[0].span).toBe('full');
    expect(rows[0].items.length).toBe(1);
    expect(rows[1].items[0].unit.index).toBe(1);
  });

  it('forces full width when half-width height exceeds 1.6x full height', () => {
    const { rows } = packUnits([u(0, 100, 170)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items[0].span).toBe('full');
  });

  it('spills units that do not fit, whole and in order', () => {
    const units = [u(0, 400, 400), u(1, 400, 400), u(2, 400, 400), u(3, 400, 400)];
    const { rows, spill } = packUnits(units, { columns: 2, pageHeight: 900, rowGap: 10 });
    expect(rows.length).toBe(2);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([]);

    const tight = packUnits(
      [u(0, 500, 500, { forceFull: true }), u(1, 500, 500, { forceFull: true }), u(2, 500, 500, { forceFull: true })],
      { columns: 2, pageHeight: 1020, rowGap: 10 }
    );
    expect(tight.spill.map((s: { index: number }) => s.index)).toEqual([2]);
  });

  it('swaps adjacent units when the swap fills a gap', () => {
    // unit 1 is full-width so it cannot pair; unit 2 is half and fits beside unit 0.
    const units = [u(0, 100, 100), u(1, 100, 100, { forceFull: true }), u(2, 100, 100)];
    const { rows } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items.map((i: { unit: { index: number } }) => i.unit.index)).toEqual([0, 2]);
    expect(rows[1].items[0].unit.index).toBe(1);
  });

  it('is deterministic for identical input', () => {
    const units = [u(0, 120, 200), u(1, 90, 90), u(2, 300, 300, { forceFull: true }), u(3, 90, 90)];
    const opts = { columns: 2, pageHeight: 1000, rowGap: 10 };
    expect(JSON.stringify(packUnits(units, opts))).toBe(JSON.stringify(packUnits(units, opts)));
  });
});
