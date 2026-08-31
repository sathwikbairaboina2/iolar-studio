import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * The bar you actually drag. Two things matter here: the lane has to span
 * everything on it, and a drag has to send exactly one command — on release.
 * A command per pointermove would write a history entry every 16ms.
 */

afterEach(cleanup);

const clip = (id: string, start: number, end: number) => ({
  id,
  assetId: 'a1',
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] },
  transition: 'cut' as const,
  locked: false,
});

async function build(over: Record<string, unknown> = {}) {
  const { validateReel, emptyReel } = await import('@/lib/reel/schema');
  return validateReel({
    ...emptyReel('grok'),
    title: 'Grok',
    vo: { durationSec: 8 },
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 0, 2), clip('c2', 2, 4), clip('c3', 4, 6)],
      captions: [
        { id: 'k1', text: 'one', start: 0.5, end: 1.4 },
        { id: 'k2', text: 'two', start: 4.0, end: 5.0 },
      ],
      overlays: [],
    },
    ...over,
  });
}

/** jsdom measures everything as zero, and the lane's maths is all pixels. */
function measureLane(width = 1000, left = 0) {
  const lane = screen.getByTestId('clip-lane');
  vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
    left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}),
  } as DOMRect);
  const cues = screen.getByTestId('caption-lane');
  vi.spyOn(cues, 'getBoundingClientRect').mockReturnValue({
    left, right: left + width, width, top: 0, bottom: 22, height: 22, x: left, y: 0, toJSON: () => ({}),
  } as DOMRect);
  return { lane, cues };
}

async function mount(props: Record<string, unknown> = {}) {
  const Timeline = (await import('@/components/reel/Timeline')).default;
  const onCommand = vi.fn();
  const onSeek = vi.fn();
  const reel = (props.reel as never) ?? (await build());
  render(
    <Timeline
      reel={reel}
      currentTime={1}
      selectedClipId={null}
      selectedCueId={null}
      onSeek={onSeek}
      onSelectClip={() => {}}
      onSelectCue={() => {}}
      onCommand={onCommand}
      {...props}
    />
  );
  return { onCommand, onSeek };
}

function drag(el: HTMLElement, from: number, to: number, steps = 4) {
  fireEvent.pointerDown(el, { clientX: from, button: 0, pointerId: 1 });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(window, { clientX: from + ((to - from) * i) / steps, pointerId: 1 });
  }
  fireEvent.pointerUp(window, { clientX: to, pointerId: 1 });
}

describe('timeline lane span', () => {
  it('spans the captions when they outlive the clips', async () => {
    // Clips end at 6s; a cue runs to 11s. Sizing by clips alone puts it at 183%.
    const reel = await build({
      timeline: {
        clips: [clip('c1', 0, 2), clip('c2', 2, 4), clip('c3', 4, 6)],
        captions: [{ id: 'k9', text: 'late', start: 10, end: 11 }],
        overlays: [],
      },
    });
    await mount({ reel });

    const cue = screen.getByTestId('cue-k9');
    const left = parseFloat(cue.style.left);
    const width = parseFloat(cue.style.width);

    expect(left + width).toBeLessThanOrEqual(100);
  });

  it('spans the voiceover when it outlives everything drawn', async () => {
    const reel = await build({
      vo: { durationSec: 30 },
      timeline: { clips: [clip('c1', 0, 2)], captions: [], overlays: [] },
    });
    await mount({ reel });

    // 2s of clip on a 30s lane is a narrow block, not the whole bar.
    expect(parseFloat(screen.getByTestId('clip-c1').style.width)).toBeLessThan(20);
  });

  it('never positions anything past the end of the lane', async () => {
    const reel = await build({
      timeline: {
        clips: [clip('c1', 0, 2)],
        captions: [{ id: 'k9', text: 'late', start: 10, end: 11 }],
        overlays: [],
      },
    });
    await mount({ reel });

    for (const el of Array.from(document.querySelectorAll('[data-testid^="cue-"],[data-testid^="clip-c"]'))) {
      const { left, width } = (el as HTMLElement).style;
      expect(parseFloat(left) + parseFloat(width)).toBeLessThanOrEqual(100.01);
    }
  });
});

describe('dragging a clip', () => {
  it('reorders it to the slot it was dropped on', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    // Lane spans 8s over 1000px. c1 sits in slot 0; drop it inside c3's span.
    drag(screen.getByTestId('clip-c1'), 100, 650);

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('clip.move', { clipId: 'c1', toIndex: 2 });
  });

  it('sends nothing while the pointer is still moving', async () => {
    const { onCommand } = await mount();
    measureLane(1000);
    const el = screen.getByTestId('clip-c1');

    fireEvent.pointerDown(el, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 500, pointerId: 1 });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('does nothing when the clip is dropped back where it started', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('clip-c1'), 100, 110);

    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe('dragging a clip edge', () => {
  it('trims the out edge by the distance dragged', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    // 1000px / 8s = 125px per second. 125px left = one second shorter.
    drag(screen.getByTestId('trim-c2-out'), 500, 375);

    expect(onCommand).toHaveBeenCalledTimes(1);
    const [op, args] = onCommand.mock.calls[0];
    expect(op).toBe('clip.trim');
    expect(args.clipId).toBe('c2');
    expect(args.edge).toBe('out');
    expect(args.deltaSec).toBeCloseTo(-1, 2);
  });

  it('trims the in edge', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('trim-c2-in'), 250, 312.5);

    const [op, args] = onCommand.mock.calls[0];
    expect(op).toBe('clip.trim');
    expect(args.edge).toBe('in');
    expect(args.deltaSec).toBeCloseTo(0.5, 2);
  });

  it('does not also reorder the clip it was trimming', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('trim-c2-out'), 500, 375);

    expect(onCommand.mock.calls.map((c) => c[0])).toEqual(['clip.trim']);
  });
});

describe('dragging a caption', () => {
  it('nudges the cue by the time dragged', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('cue-k1'), 100, 162.5);

    expect(onCommand).toHaveBeenCalledTimes(1);
    const [op, args] = onCommand.mock.calls[0];
    expect(op).toBe('caption.nudge');
    expect(args.cueId).toBe('k1');
    expect(args.deltaSec).toBeCloseTo(0.5, 2);
  });

  it('ignores a nudge too small to have been meant', async () => {
    const { onCommand } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('cue-k1'), 100, 101);

    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe('the playhead', () => {
  it('seeks while dragged, without issuing a command', async () => {
    const { onCommand, onSeek } = await mount();
    measureLane(1000);

    drag(screen.getByTestId('playhead'), 125, 500);

    expect(onCommand).not.toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalled();
    expect(onSeek.mock.calls.at(-1)![0]).toBeCloseTo(4, 1);
  });

  it('seeks on a plain click in the lane', async () => {
    const { onSeek } = await mount();
    measureLane(1000);

    fireEvent.pointerDown(screen.getByTestId('clip-lane'), { clientX: 250, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 250, pointerId: 1 });

    expect(onSeek).toHaveBeenCalled();
    expect(onSeek.mock.calls.at(-1)![0]).toBeCloseTo(2, 1);
  });
});
