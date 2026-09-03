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
  const { loadStyle } = await import('@/lib/reel/styles');
  const reel = validateReel({
    style: 'armand',
    title: 'Grok',
    beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'broll', brief: '' } }],
    vo: { durationSec: 6 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'plugin', status: 'ready' },
      { id: 'a3', kind: 'video', path: '', origin: 'plugin', status: 'queued' },
    ],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a2', 4, 9)],
      captions: [{ id: 'k1', text: 'just launched', start: 0.5, end: 1.4 }],
      overlays: [{ id: 'o1', kind: 'hook-title', start: 0, end: 1.6, props: { title: 'xAI drops Grok Bot' } }],
    },
    ...over,
  });
  return { reel, style: await loadStyle('armand') };
}

describe('reel player', () => {
  it('shows the clip, caption and overlay live at that timestamp', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a1');
    expect(screen.getByTestId('reel-caption').textContent).toBe('just launched');
    expect(screen.getByTestId('reel-overlay').textContent).toBe('xAI drops Grok Bot');
  });

  it('applies the same motion transform the export computes', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { motionCss, motionOriginCss } = await import('@/lib/reel/motion');
    const { reel, style } = await build();
    render(
      <Player reel={reel} style={style} slug="grok" currentTime={2} playing={false} onTimeChange={() => {}} />
    );
    const video = screen.getByTestId('reel-video') as HTMLVideoElement;
    const motion = reel.timeline.clips[0].motion;
    expect(video.style.transform).toBe(motionCss(motion, 0.5));
    expect(video.style.transformOrigin).toBe(motionOriginCss(motion));
  });

  it('swaps to the next clip as time moves past the cut', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const { rerender } = render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a1');
    rerender(
      <Player reel={reel} style={style} slug="grok" currentTime={5} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-video').getAttribute('data-asset')).toBe('a2');
    expect(screen.queryByTestId('reel-caption')).toBeNull();
  });

  it('shows a placeholder instead of a black frame while a shot is still generating', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const pending = validateReel({
      ...reel,
      timeline: { ...reel.timeline, clips: [clip('c1', 'a3', 0, 4)], captions: [], overlays: [] },
    });
    render(
      <Player reel={pending} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-pending').textContent).toMatch(/generating/i);
  });

  it('surfaces the reason a shot needs a hand', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const stuck = validateReel({
      ...reel,
      assets: [{ id: 'a3', kind: 'video', path: '', origin: 'plugin', status: 'awaiting-manual', error: 'No video provider is wired' }],
      timeline: { ...reel.timeline, clips: [clip('c1', 'a3', 0, 4)], captions: [], overlays: [] },
    });
    render(
      <Player reel={stuck} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    expect(screen.getByTestId('reel-pending').textContent).toMatch(/no video provider/i);
  });

  it('does not restart the playback run when the studio re-renders with fresh callbacks', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const { rerender } = render(
      <Player
        reel={reel}
        style={style}
        slug="grok"
        currentTime={0}
        playing
        onTimeChange={() => {}}
        onEnded={() => {}}
      />
    );
    // An own property on this element only: the prototype's play() is shared with the <video>,
    // whose own effect legitimately re-runs on every render.
    const audio = screen.getByTestId('reel-audio') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(audio, 'play', { configurable: true, value: audioPlay });

    // The studio hands Player a new arrow function on every render. That identity change must
    // not tear the clock down: re-seeding it each frame drags the voiceover back to a stale
    // timestamp, so audio crawls and the video stutters against it.
    rerender(
      <Player
        reel={reel}
        style={style}
        slug="grok"
        currentTime={0}
        playing
        onTimeChange={() => {}}
        onEnded={() => {}}
      />
    );

    expect(audioPlay).not.toHaveBeenCalled();
  });

  it('lets a recording speak for itself instead of the voiceover under it', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { validateReel } = await import('@/lib/reel/schema');
    const { reel, style } = await build();
    const own = validateReel({
      ...reel,
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', takeStart: 0, durationSec: 4 }],
      timeline: { ...reel.timeline, clips: [clip('c1', 'a1', 0, 4)], captions: [], overlays: [] },
    });
    render(
      <Player reel={own} style={style} slug="grok" currentTime={1} playing onTimeChange={() => {}} />
    );

    // The lips were made from the audio inside this file. Hearing the voiceover over the top
    // is a second copy of the same words, slightly out.
    expect((screen.getByTestId('reel-video') as HTMLVideoElement).muted).toBe(false);
    expect((screen.getByTestId('reel-audio') as HTMLAudioElement).muted).toBe(true);
  });

  it('keeps the voiceover under footage that brought no sound of its own', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing onTimeChange={() => {}} />
    );
    expect((screen.getByTestId('reel-video') as HTMLVideoElement).muted).toBe(true);
    expect((screen.getByTestId('reel-audio') as HTMLAudioElement).muted).toBe(false);
  });

  it('exposes the style custom properties on the stage', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    const stage = screen.getByTestId('reel-stage');
    expect(stage.style.getPropertyValue('--cap-y')).toBe('84%');
    expect(stage.style.getPropertyValue('--cap-size')).toBe('1.9cqh');
  });
  it('wraps a clip that outruns its source, the way the export loops the footage', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build({
      timeline: { clips: [clip('c1', 'a1', 0, 4, { srcIn: 5 })], captions: [], overlays: [] },
    });
    const { rerender } = render(
      <Player reel={reel} style={style} slug="grok" currentTime={0} playing={false} onTimeChange={() => {}} />
    );
    const video = screen.getByTestId('reel-video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 });
    rerender(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    // ffmpeg reads these inputs with -stream_loop -1, so second 6 of a 4s source is second 2.
    expect(video.currentTime).toBeCloseTo(2, 3);
  });

  it('stops re-seeking a wrapped clip once it is in position', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build({
      timeline: { clips: [clip('c1', 'a1', 0, 4, { srcIn: 5 })], captions: [], overlays: [] },
    });
    const { rerender } = render(
      <Player reel={reel} style={style} slug="grok" currentTime={0} playing={false} onTimeChange={() => {}} />
    );
    const video = screen.getByTestId('reel-video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 });
    // A real element clamps a seek past the end, which is what turned one bad seek into one
    // per animation frame: the drift never closed.
    let ct = 0;
    const seeks: number[] = [];
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => ct,
      set: (v: number) => {
        ct = Math.min(v, 4);
        seeks.push(v);
      },
    });
    for (const t of [1, 1.1, 1.2, 1.3]) {
      rerender(
        <Player reel={reel} style={style} slug="grok" currentTime={t} playing={false} onTimeChange={() => {}} />
      );
      ct = Math.min(ct + 0.1, 4);
    }
    expect(seeks.length).toBe(1);
  });

  it('holds the next clip loaded off-screen so the cut has something to show', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    const pre = screen.getAllByTestId('reel-preload');
    expect(pre[0].getAttribute('data-asset')).toBe('a2');
    expect(pre[0].getAttribute('src')).toContain('id=a2');
  });

  it('stops the shot it has cut away from', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const { rerender } = render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing onTimeChange={() => {}} />
    );
    const first = screen.getByTestId('reel-video') as HTMLVideoElement;
    const pause = vi.fn();
    Object.defineProperty(first, 'pause', { configurable: true, value: pause });

    rerender(
      <Player reel={reel} style={style} slug="grok" currentTime={5} playing onTimeChange={() => {}} />
    );

    // Left running, it plays on behind the shot you are watching — and with loop on it wraps
    // for ever, holding a decoder open for every clip the reel has been through.
    expect(pause).toHaveBeenCalled();
  });

  it('keeps several shots loading, not just the next one', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { validateReel } = await import('@/lib/reel/schema');
    const { reel, style } = await build();
    const many = validateReel({
      ...reel,
      assets: ['a1', 'a2', 'a4', 'a5'].map((id) => ({
        id, kind: 'video', path: `assets/${id}.mp4`, origin: 'plugin', status: 'ready',
      })),
      timeline: {
        ...reel.timeline,
        clips: [clip('c1', 'a1', 0, 2), clip('c2', 'a2', 2, 4), clip('c3', 'a4', 4, 6), clip('c4', 'a5', 6, 8)],
      },
    });
    render(
      <Player reel={many} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    // A reel cut to speech runs under two seconds a shot; one shot of runway is not enough
    // to have the bytes ready by the time the cut arrives.
    expect(screen.getAllByTestId('reel-preload').map((e) => e.getAttribute('data-asset'))).toEqual(['a2', 'a4', 'a5']);
  });

  it('promotes that same element at the cut instead of mounting a fresh one', async () => {
    const Player = (await import('@/components/reel/Player')).default;
    const { reel, style } = await build();
    const { rerender } = render(
      <Player reel={reel} style={style} slug="grok" currentTime={1} playing={false} onTimeChange={() => {}} />
    );
    const preloaded = screen.getAllByTestId('reel-preload')[0];
    rerender(
      <Player reel={reel} style={style} slug="grok" currentTime={5} playing={false} onTimeChange={() => {}} />
    );
    // A remount means an empty decoder and a black frame for as long as the file takes to load.
    expect(screen.getByTestId('reel-video')).toBe(preloaded);
  });
});
