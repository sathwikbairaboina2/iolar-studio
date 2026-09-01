'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Reel } from '@/lib/reel/schema';
import { timelineDuration } from '@/lib/reel/timeline';

/**
 * Where you are in the reel.
 *
 * It used to be an editing surface: drag an edge to trim, drag a block to reorder, drag a
 * cue to nudge it. Cutting happens in an editor now, so what is left is the part that was
 * always useful here — seeing which recording covers which stretch, and moving the playhead
 * to look at one.
 */

export type TimelineProps = {
  reel: Reel;
  currentTime: number;
  onSeek: (t: number) => void;
};

const STATUS_TINT: Record<string, string> = {
  ready: 'var(--tl-ready, #3b82f6)',
  running: 'var(--tl-running, #a855f7)',
  queued: 'var(--tl-queued, #6b7280)',
  failed: 'var(--tl-failed, #ef4444)',
  'awaiting-manual': 'var(--tl-manual, #f59e0b)',
};

/**
 * How much time the bar has to show.
 *
 * Not just the clips: the voiceover can outlast them, and sizing by clips alone put the
 * playhead off the end of its own track.
 */
export function laneSpan(reel: Reel): number {
  return Math.max(timelineDuration(reel.timeline), reel.vo?.durationSec ?? 0, 1);
}

export default function Timeline({ reel, currentTime, onSeek }: TimelineProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const span = laneSpan(reel);
  const pct = useCallback((t: number) => `${Math.max(0, Math.min(100, (t / span) * 100))}%`, [span]);

  const timeAtX = useCallback(
    (clientX: number) => {
      const box = laneRef.current?.getBoundingClientRect();
      if (!box) return 0;
      return Math.max(0, Math.min(span, ((clientX - box.left) / box.width) * span));
    },
    [span]
  );

  useEffect(() => {
    if (!scrubbing) return;
    const move = (e: PointerEvent) => onSeek(timeAtX(e.clientX));
    const up = () => setScrubbing(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [scrubbing, onSeek, timeAtX]);

  const blocks = useMemo(
    () =>
      reel.timeline.clips.map((c) => {
        const asset = reel.assets.find((a) => a.id === c.assetId);
        return {
          id: c.id,
          left: pct(c.start),
          width: `${Math.max(0.4, ((c.end - c.start) / span) * 100)}%`,
          tint: STATUS_TINT[asset?.status ?? 'queued'] ?? STATUS_TINT.queued,
          label: asset?.provider ?? asset?.origin ?? '',
        };
      }),
    [reel.timeline.clips, reel.assets, pct, span]
  );

  const ticks = useMemo(() => {
    const step = span > 90 ? 20 : span > 30 ? 10 : 5;
    return Array.from({ length: Math.floor(span / step) }, (_, i) => (i + 1) * step);
  }, [span]);

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <div style={{ position: 'relative', height: 14, fontSize: 10, color: '#8a8a99' }}>
        {ticks.map((t) => (
          <span key={t} style={{ position: 'absolute', left: pct(t), transform: 'translateX(-50%)' }}>
            {t}s
          </span>
        ))}
      </div>

      <div
        ref={laneRef}
        data-testid="timeline-lane"
        onPointerDown={(e) => {
          setScrubbing(true);
          onSeek(timeAtX(e.clientX));
        }}
        style={{
          position: 'relative',
          height: 44,
          borderRadius: 6,
          background: 'var(--tl-bed, #f1f1f4)',
          overflow: 'hidden',
          cursor: 'pointer',
        }}
      >
        {blocks.map((b) => (
          <div
            key={b.id}
            data-testid="timeline-clip"
            style={{
              position: 'absolute',
              left: b.left,
              width: b.width,
              top: 4,
              bottom: 4,
              background: b.tint,
              borderRadius: 4,
              color: '#fff',
              fontSize: 10,
              padding: '2px 6px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {b.label}
          </div>
        ))}

        <div
          data-testid="timeline-playhead"
          style={{
            position: 'absolute',
            left: pct(currentTime),
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--tl-head, #e8384f)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
