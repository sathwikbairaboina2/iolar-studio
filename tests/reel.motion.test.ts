import { describe, it, expect } from 'vitest';

const zoomIn = { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] };

describe('motion', () => {
  it('zoom-in grows from 1 to 1+strength across the clip', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    expect(motionScaleAt(zoomIn, 0).scale).toBeCloseTo(1, 5);
    expect(motionScaleAt(zoomIn, 1).scale).toBeCloseTo(1.12, 5);
    expect(motionScaleAt(zoomIn, 0.5).scale).toBeCloseTo(1.06, 5);
  });

  it('zoom-out is zoom-in reversed and hold never moves', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const out = { ...zoomIn, type: 'zoom-out' as const };
    expect(motionScaleAt(out, 0).scale).toBeCloseTo(1.12, 5);
    expect(motionScaleAt(out, 1).scale).toBeCloseTo(1, 5);
    const hold = { ...zoomIn, type: 'hold' as const };
    expect(motionScaleAt(hold, 0.7)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('pans translate while staying zoomed in so no edge shows', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const left = { ...zoomIn, type: 'pan-left' as const };
    expect(motionScaleAt(left, 0).tx).toBeCloseTo(0.06, 5);
    expect(motionScaleAt(left, 1).tx).toBeCloseTo(-0.06, 5);
    expect(motionScaleAt(left, 0.5).scale).toBeCloseTo(1.12, 5);
  });

  it('clamps progress outside 0..1', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    expect(motionScaleAt(zoomIn, -3).scale).toBeCloseTo(1, 5);
    expect(motionScaleAt(zoomIn, 9).scale).toBeCloseTo(1.12, 5);
  });

  it('emits a css transform the preview can apply verbatim', async () => {
    const { motionCss, motionOriginCss } = await import('@/lib/reel/motion');
    expect(motionCss(zoomIn, 0.5)).toBe('scale(1.06) translate(0%, 0%)');
    expect(motionOriginCss(zoomIn)).toBe('50% 40%');
  });

  it('emits a zoompan filter whose zoom expression matches the css scale at both ends', async () => {
    const { motionFfmpeg, motionScaleAt } = await import('@/lib/reel/motion');
    const frames = 150;
    const f = motionFfmpeg(zoomIn, { fps: 30, frames, width: 1080, height: 1920 });
    expect(f).toContain('zoompan=');
    expect(f).toContain('s=1080x1920');
    expect(f).toContain('fps=30');
    expect(f).toContain('d=1');

    // The z expression is ffmpeg arithmetic over `on` (output frame number); evaluate it
    // at the first and last frame and compare with what the preview would show.
    const z = f.match(/z='([^']+)'/)![1];
    const evalZ = (on: number) => Function('on', `return ${z};`)(on) as number;
    expect(evalZ(0)).toBeCloseTo(motionScaleAt(zoomIn, 0).scale, 5);
    expect(evalZ(frames - 1)).toBeCloseTo(motionScaleAt(zoomIn, 1).scale, 5);
  });

  it('pans move the crop window across the frame', async () => {
    const { motionFfmpeg } = await import('@/lib/reel/motion');
    const f = motionFfmpeg(
      { type: 'pan-left', strength: 0.12, origin: [0.5, 0.5] },
      { fps: 30, frames: 90, width: 1080, height: 1920 }
    );
    const x = f.match(/x='([^']+)'/)![1];
    const at = (on: number) => Function('iw', 'zoom', 'on', `return ${x};`)(1000, 1.12, on) as number;
    expect(at(0)).toBeGreaterThan(at(89));
  });

  it('hold still produces a valid filter so every clip has one', async () => {
    const { motionFfmpeg } = await import('@/lib/reel/motion');
    const f = motionFfmpeg(
      { type: 'hold', strength: 0, origin: [0.5, 0.5] },
      { fps: 30, frames: 90, width: 1080, height: 1920 }
    );
    expect(f).toContain('zoompan=');
    expect(f).toContain("z='1'");
  });
});

describe('vertical pans read as a scroll', () => {
  it('travels down the frame over the clip', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const up = { type: 'pan-up' as const, strength: 0.3, origin: [0.5, 0.5] as [number, number] };
    expect(motionScaleAt(up, 0).ty).toBeCloseTo(0.15, 5);
    expect(motionScaleAt(up, 1).ty).toBeCloseTo(-0.15, 5);
    expect(motionScaleAt(up, 0.5).tx).toBe(0);
    // zoomed in throughout, so the travel never exposes an edge
    expect(motionScaleAt(up, 0.5).scale).toBeCloseTo(1.3, 5);
  });

  it('pan-down is pan-up reversed', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const down = { type: 'pan-down' as const, strength: 0.3, origin: [0.5, 0.5] as [number, number] };
    expect(motionScaleAt(down, 0).ty).toBeCloseTo(-0.15, 5);
    expect(motionScaleAt(down, 1).ty).toBeCloseTo(0.15, 5);
  });

  it('moves the ffmpeg crop window vertically, not horizontally', async () => {
    const { motionFfmpeg } = await import('@/lib/reel/motion');
    const f = motionFfmpeg(
      { type: 'pan-up', strength: 0.3, origin: [0.5, 0.5] },
      { fps: 30, frames: 90, width: 1080, height: 1920 }
    );
    const y = f.match(/y='([^']+)'/)![1];
    const x = f.match(/x='([^']+)'/)![1];
    const atY = (on: number) => Function('ih', 'zoom', 'on', `return ${y};`)(1000, 1.3, on) as number;
    const atX = (on: number) => Function('iw', 'zoom', 'on', `return ${x};`)(1000, 1.3, on) as number;
    expect(atY(0)).toBeGreaterThan(atY(89));
    expect(atX(0)).toBeCloseTo(atX(89), 5);
  });
});
