import { describe, it, expect } from 'vitest';

describe('styles', () => {
  it('loads the armand preset with its caption geometry', async () => {
    const { loadStyle } = await import('@/lib/reel/styles');
    const p = await loadStyle('armand');
    expect(p.caption.yPct).toBe(84);
    expect(p.caption.wordsPerBeat).toEqual([1, 3]);
    expect(p.pacing.shotSec[0]).toBeLessThan(p.pacing.shotSec[1]);
    expect(p.transitions.length).toBeGreaterThan(0);
  });

  it('lists every style directory', async () => {
    const { listStyles } = await import('@/lib/reel/styles');
    const names = (await listStyles()).map((p) => p.name);
    expect(names).toContain('armand');
  });

  it('emits css custom properties the stylesheet consumes', async () => {
    const { loadStyle, styleCssVars } = await import('@/lib/reel/styles');
    const vars = styleCssVars(await loadStyle('armand'));
    expect(vars).toContain('--cap-y: 84%');
    expect(vars).toContain('--cap-size: 1.9cqh');
    expect(vars).toContain('--cap-pill: rgba(0, 0, 0, 0.85)');
    expect(vars).toContain('--hook-size: 6cqh');
  });

  it('rejects a style missing its caption block', async () => {
    const { validateStyle } = await import('@/lib/reel/styles');
    expect(() => validateStyle({ name: 'x', displayName: 'X' })).toThrow();
  });

  it('reads the style stylesheet and hook markup from disk', async () => {
    const { styleCss, styleHookHtml } = await import('@/lib/reel/styles');
    expect(await styleCss('armand')).toContain('.reel-caption');
    expect(await styleHookHtml('armand')).toContain('{{title}}');
  });
});

describe('pacing matches the reference reel', () => {
  it('holds shots for the range measured off the reference, not the guess it started with', async () => {
    const { loadStyle } = await import('@/lib/reel/styles');
    const p = await loadStyle('armand');
    // measured: p20 1.0s, median 2.0s, p80 3.3s over 18 shots in 51.6s
    expect(p.pacing.shotSec[0]).toBeLessThanOrEqual(2);
    expect(p.pacing.shotSec[1]).toBeLessThanOrEqual(4.5);
  });

  it('sizes captions like the reference, which measures 2.3 against our first 4.1', async () => {
    const { loadStyle } = await import('@/lib/reel/styles');
    expect((await loadStyle('armand')).caption.sizeVh).toBeLessThan(2.5);
  });
});
