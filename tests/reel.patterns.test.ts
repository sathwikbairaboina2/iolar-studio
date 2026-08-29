import { describe, it, expect } from 'vitest';

describe('patterns', () => {
  it('loads the armand preset with its caption geometry', async () => {
    const { loadPattern } = await import('@/lib/reel/patterns');
    const p = await loadPattern('armand');
    expect(p.caption.yPct).toBe(73);
    expect(p.caption.wordsPerBeat).toEqual([1, 3]);
    expect(p.pacing.shotSec[0]).toBeLessThan(p.pacing.shotSec[1]);
    expect(p.transitions.length).toBeGreaterThan(0);
  });

  it('lists every pattern directory', async () => {
    const { listPatterns } = await import('@/lib/reel/patterns');
    const names = (await listPatterns()).map((p) => p.name);
    expect(names).toContain('armand');
  });

  it('emits css custom properties the stylesheet consumes', async () => {
    const { loadPattern, patternCssVars } = await import('@/lib/reel/patterns');
    const vars = patternCssVars(await loadPattern('armand'));
    expect(vars).toContain('--cap-y: 73%');
    expect(vars).toContain('--cap-size: 3.2cqh');
    expect(vars).toContain('--cap-pill: rgba(0, 0, 0, 0.85)');
    expect(vars).toContain('--hook-size: 6cqh');
  });

  it('rejects a pattern missing its caption block', async () => {
    const { validatePattern } = await import('@/lib/reel/patterns');
    expect(() => validatePattern({ name: 'x', displayName: 'X' })).toThrow();
  });

  it('reads the pattern stylesheet and hook markup from disk', async () => {
    const { patternCss, patternHookHtml } = await import('@/lib/reel/patterns');
    expect(await patternCss('armand')).toContain('.reel-caption');
    expect(await patternHookHtml('armand')).toContain('{{title}}');
  });
});
