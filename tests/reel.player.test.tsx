import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no media stack.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});

const clip = (id: string, assetId: string, start: number, end: number, over = {}) => ({
  id,
  assetId,
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] },
  transition: 'cut' as const,
  locked: false,
  ...over,
});

async function build(over: Record<string, unknown> = {}) {
  const { validateReel } = await import('@/lib/reel/schema');
  const { loadPattern } = await import('@/lib/reel/patterns');
  const reel = validateReel({
    pattern: 'armand',
    title: 'Grok',
    beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'broll', brief: '' } }],
    vo: { durationSec: 6 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready' },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'comfy', status: 'ready' },
      { id: 'a3', kind: 'video', path: '', origin: 'comfy', status: 'queued' },
    ],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a2', 4, 9)],
      captions: [{ id: 'k1', text: 'just launched', start: 0.5, end: 1.4 }],
      overlays: [{ id: 'o1', kind: 'hook-title', start: 0, end: 1.6, props: { title: 'xAI drops Grok Bot' } }],
    },
    ...over,
  });
  return { reel, pattern: await loadPattern('armand') };
}

describe('reel player', () => {
  it('shows the clip, caption and overlay live at that timestamp', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, pattern } = await build();
    render(
      <Player reel={reel} pattern={pattern} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a1');
    expect(screen.getByTestId('reel-caption').textContent).toBe('just launched');
    expect(screen.getByTestId('reel-overlay').textContent).toBe('xAI drops Grok Bot');
  });

  it('applies the same motion transform the export computes', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { motionCss, motionOriginCss } = await import('@/lib/reel/motion');
    const { reel, pattern } = await build();
    render(
      <Player reel={reel} pattern={pattern} slug="grok" currentTime={2} playing={false} onTimeChange={() => {}} />
    );
    const video = screen.getByTestId('reel-video') as HTMLVideoElement;
    const motion = reel.timeline.clips[0].motion;
    expect(video.style.transform).toBe(motionCss(motion, 0.5));
    expect(video.style.transformOrigin).toBe(motionOriginCss(motion));
  });

  it('swaps to the next clip as time moves past the cut', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, pattern } = await build();
    const { rerender } = render(
      <Player reel={reel} pattern={pattern} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a1');
    rerender(
      <Player reel={reel} pattern={pattern} slug="grok" currentTime={5} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a2');
    expect(screen.queryByTestId('reel-caption')).toBeNull();
  });

  it('shows a placeholder instead of a black frame while a shot is still generating', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, pattern } = await build();
    const pending = validateReel({
      ...reel,
      timeline: { ...reel.timeline, clips: [clip('c1', 'a3', 0, 4)], captions: [], overlays: [] },
    });
    render(
      <Player reel={pending} pattern={pattern} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-pending').textContent).toMatch(/generating/i);
  });

  it('surfaces the reason a shot needs a hand', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, pattern } = await build();
    const stuck = validateReel({
      ...reel,
      assets: [{ id: 'a3', kind: 'video', path: '', origin: 'comfy', status: 'awaiting-manual', error: 'ComfyUI is not reachable' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 'a3', 0, 4)], captions: [], overlays: [] },
    });
    render(
      <Player reel={stuck} pattern={pattern} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-pending').textContent).toMatch(/not reachable/i);
  });

  it('exposes the pattern custom properties on the stage', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, pattern } = await build();
    render(
      <Player reel={reel} pattern={pattern} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    const stage = screen.getByTestId('reel-stage');
    expect(stage.style.getPropertyValue('--cap-y')).toBe('73%');
    expect(stage.style.getPropertyValue('--cap-size')).toBe('3.2vh');
  });
});
