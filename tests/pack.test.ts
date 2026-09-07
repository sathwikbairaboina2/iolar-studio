import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require_ = createRequire(import.meta.url);
const { packUnits, packedHeight } = require_(path.join(process.cwd(), 'templates/_shared/pack.js'));

type Unit = { index: number; fullH: number; halfH: number; forceFull?: boolean };
type Band = { span: 'full' | 'cols'; cols: Unit[][]; height: number };

const u = (index: number, fullH: number, halfH: number, extra: object = {}) =>
  ({ index, type: 'bullets', boundIndexes: [index], fullH, halfH, ...extra });

const shape = (bands: Band[]) => bands.map((b) => b.cols.map((c) => c.map((x) => x.index)));

describe('packUnits', () => {
  it('flows units down the first column, then the next', () => {
    const units = [u(0, 100, 100), u(1, 100, 100), u(2, 100, 100), u(3, 100, 100)];
    const { bands, spill } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(spill).toEqual([]);
    expect(shape(bands)).toEqual([[[0, 1], [2, 3]]]);
  });

  it('balances a run that fits instead of running one column to the bottom', () => {
    const units = [u(0, 100, 100), u(1, 100, 100), u(2, 100, 100)];
    const { bands } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(shape(bands)).toEqual([[[0, 1], [2]]]);
    expect(bands[0].height).toBe(200);
  });

  it('gives a forced full-width unit its own band and keeps the order around it', () => {
    const units = [u(0, 100, 100), u(1, 300, 300, { forceFull: true }), u(2, 100, 100)];
    const { bands } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(shape(bands)).toEqual([[[0]], [[1]], [[2]]]);
    // Each band holds one unit, so each takes the full width rather than stranding a column.
    expect(bands.map((b: Band) => b.span)).toEqual(['full', 'full', 'full']);
  });

  it('sends a unit that more than doubles when squeezed to full width', () => {
    const { bands } = packUnits([u(0, 100, 250)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(bands[0].span).toBe('full');
    expect(bands[0].height).toBe(100);

    // Prose roughly 1.7x when halved — still a win on area, so it stays in a column.
    const prose = packUnits([u(0, 100, 170), u(1, 100, 170)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(prose.bands[0].span).toBe('cols');
    expect(shape(prose.bands)).toEqual([[[0], [1]]]);
  });

  it('fills the page to the bottom and spills the rest, in order', () => {
    const units = [u(0, 200, 200), u(1, 200, 200), u(2, 200, 200), u(3, 200, 200), u(4, 200, 200)];
    const { bands, spill } = packUnits(units, { columns: 2, pageHeight: 400, rowGap: 0 });
    expect(shape(bands)).toEqual([[[0, 1], [2, 3]]]);
    expect(spill.map((s: Unit) => s.index)).toEqual([4]);
  });

  it('spills a full-width band that does not fit under what is already placed', () => {
    const units = [u(0, 300, 300), u(1, 500, 500, { forceFull: true })];
    const { bands, spill } = packUnits(units, { columns: 2, pageHeight: 600, rowGap: 10 });
    expect(bands.length).toBe(1);
    expect(spill.map((s: Unit) => s.index)).toEqual([1]);
  });

  it('keeps one oversized unit rather than spilling an empty page', () => {
    const units = [u(0, 900, 900), u(1, 100, 100)];
    const { bands, spill } = packUnits(units, { columns: 2, pageHeight: 500, rowGap: 10 });
    expect(shape(bands)).toEqual([[[0]]]);
    expect(spill.map((s: Unit) => s.index)).toEqual([1]);
  });

  it('lets a unit alone in a band use the whole width', () => {
    // A short run between two full-width units would otherwise sit in one column with the
    // other left blank, which is what made a thin last page look like an accident.
    const units = [
      u(0, 200, 400, { forceFull: true }),
      u(1, 60, 100),
      u(2, 200, 400, { forceFull: true }),
    ];
    const { bands } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(bands.map((b: Band) => b.span)).toEqual(['full', 'full', 'full']);
    // Full width, so the lonely unit is measured at its full-width height, not its column one.
    expect(bands[1].height).toBe(60);
  });

  it('leaves a band with two units in columns', () => {
    const units = [u(0, 100, 100), u(1, 100, 100)];
    const { bands } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(bands[0].span).toBe('cols');
    expect(shape(bands)).toEqual([[[0], [1]]]);
  });

  it('is deterministic for identical input', () => {
    const units = [u(0, 120, 200), u(1, 90, 90), u(2, 300, 300, { forceFull: true }), u(3, 90, 90)];
    const opts = { columns: 2, pageHeight: 1000, rowGap: 10 };
    expect(JSON.stringify(packUnits(units, opts))).toBe(JSON.stringify(packUnits(units, opts)));
  });

  it('counts gaps between bands, not before the first', () => {
    const units = [u(0, 100, 100), u(1, 200, 200, { forceFull: true })];
    const { bands } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(packedHeight(bands, 10)).toBe(310);
  });
});
