'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Reel } from '@/lib/reel/schema';
import { timelineDuration } from '@/lib/reel/timeline';

export type TimelineProps = {
  reel: Reel;
  currentTime: number;
  selectedClipId: string | null;
  selectedCueId: string | null;
  onSeek: (t: number) => void;
  onSelectClip: (id: string) => void;
  onSelectCue: (id: string) => void;
  /** One command per gesture, sent on release. */
  onCommand?: (op: string, args: Record<string, unknown>) => void;
};

const STATUS_TINT: Record<string, string> = {
  ready: 'var(--tl-ready, #3b82f6)',
  running: 'var(--tl-running, #a855f7)',
  queued: 'var(--tl-queued, #6b7280)',
  failed: 'var(--tl-failed, #ef4444)',
  'awaiting-manual': 'var(--tl-manual, #f59e0b)',
};

/** Smaller than this and the drag was a click that wobbled. */
const MIN_NUDGE_SEC = 0.03;

/**
 * How much time the bar has to show.
 *
 * Not just the clips: captions outlive them whenever clips get trimmed and the
 * cues do not follow, and the voiceover can outlast both. Sizing by clips alone
 * put a 12s cue at 154% and pushed the whole page sideways.
 */
export function laneSpan(reel: Reel): number {
  const clips = timelineDuration(reel.timeline);
  const captions = reel.timeline.captions.reduce((max, c) => Math.max(max, c.end), 0);
  return Math.max(clips, captions, reel.vo?.durationSec ?? 0, 1);
}

/** Which clip sits under a timestamp; -1 if past the last one. */
export function slotAtTime(reel: Reel, t: number): number {
  const clips = reel.timeline.clips;
  const i = clips.findIndex((c) => t >= c.start && t < c.end);
  if (i >= 0) return i;
  return t >= (clips[clips.length - 1]?.end ?? 0) ? clips.length - 1 : -1;
}

type Drag =
  | { kind: 'clip'; id: string; fromIndex: number; startX: number; dx: number }
  | { kind: 'trim'; id: string; edge: 'in' | 'out'; startX: number; dx: number }
  | { kind: 'cue'; id: string; startX: number; dx: number }
  | { kind: 'scrub'; startX: number; dx: number };

/**
 * Clip lane over caption lane on one time axis, with a draggable playhead.
 *
 * Both lanes are memoised on the reel, so a playhead tick during playback does
 * not re-render twenty absolutely-positioned blocks sixty times a second — that
 * churn is what made the bar feel like it was fighting the pointer.
 */
export default function Timeline({
  reel,
  currentTime,
  selectedClipId,
  selectedCueId,
  onSeek,
  onSelectClip,
  onSelectCue,
  onCommand,
}: TimelineProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const span = laneSpan(reel);
  const pct = useCallback((t: number) => `${Math.max(0, Math.min(100, (t / span) * 100))}%`, [span]);

  const secondsPerPx = useCallback(() => {
    const width = laneRef.current?.getBoundingClientRect().width ?? 1;
    return span / Math.max(1, width);
  }, [span]);

  const timeAtX = useCallback(
    (clientX: number) => {
      const box = laneRef.current?.getBoundingClientRect();
      if (!box || !box.width) return 0;
      return Math.max(0, Math.min(span, ((clientX - box.left) / box.width) * span));
    },
    [span]
  );

  const begin = (next: Drag, e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = next;
    setDrag(next);
  };

  // One window-level listener pair per gesture: the pointer routinely leaves the
  // block it grabbed, and a drag that ends outside must still land.
  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = { ...current, dx: e.clientX - current.startX };
      dragRef.current = next;
      setDrag(next);
      // Scrubbing is the one gesture that reports continuously: it is a seek,
      // not an edit, so there is nothing to batch until release.
      if (next.kind === 'scrub') onSeek(timeAtX(e.clientX));
    };

    const up = (e: PointerEvent) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!current) return;

      const dx = e.clientX - current.startX;
      const deltaSec = dx * secondsPerPx();

      if (current.kind === 'scrub') return onSeek(timeAtX(e.clientX));

      if (current.kind === 'clip') {
        const toIndex = slotAtTime(reel, timeAtX(e.clientX));
        if (toIndex >= 0 && toIndex !== current.fromIndex) {
          onCommand?.('clip.move', { clipId: current.id, toIndex });
        }
        return;
      }

      if (Math.abs(deltaSec) < MIN_NUDGE_SEC) return;

      if (current.kind === 'trim') {
        onCommand?.('clip.trim', {
          clipId: current.id,
          edge: current.edge,
          deltaSec: Math.round(deltaSec * 1000) / 1000,
        });
      } else {
        onCommand?.('caption.nudge', { cueId: current.id, deltaSec: Math.round(deltaSec * 1000) / 1000 });
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, onSeek, onCommand, reel, span, secondsPerPx, timeAtX]);

  const clips = useMemo(
    () =>
      reel.timeline.clips.map((clip, index) => {
        const asset = reel.assets.find((a) => a.id === clip.assetId);
        const moving = drag?.kind === 'clip' && drag.id === clip.id;
        const trimming = drag?.kind === 'trim' && drag.id === clip.id;
        return (
          <div
            key={clip.id}
            data-testid={`clip-${clip.id}`}
            onPointerDown={(e) => {
              onSelectClip(clip.id);
              begin({ kind: 'clip', id: clip.id, fromIndex: index, startX: e.clientX, dx: 0 }, e);
            }}
            title={`${clip.id} · ${clip.motion.type} · ${(clip.end - clip.start).toFixed(2)}s — drag to reorder, drag an edge to trim`}
            style={{
              position: 'absolute',
              left: pct(clip.start),
              width: pct(clip.end - clip.start),
              top: 4,
              bottom: 4,
              background: STATUS_TINT[asset?.status ?? 'queued'],
              opacity: selectedClipId === clip.id ? 1 : 0.72,
              border: selectedClipId === clip.id ? '2px solid #fff' : '1px solid rgba(0,0,0,.25)',
              borderRadius: 4,
              fontSize: 11,
              color: '#fff',
              padding: '2px 6px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              cursor: 'grab',
              touchAction: 'none',
              transform: moving ? `translateX(${drag.dx}px)` : undefined,
              zIndex: moving || trimming ? 3 : 1,
              boxShadow: moving ? '0 4px 14px rgba(0,0,0,.4)' : undefined,
            }}
          >
            {clip.locked ? '🔒 ' : ''}
            {clip.motion.type}
            {(['in', 'out'] as const).map((edge) => (
              <span
                key={edge}
                data-testid={`trim-${clip.id}-${edge}`}
                onPointerDown={(e) => begin({ kind: 'trim', id: clip.id, edge, startX: e.clientX, dx: 0 }, e)}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  [edge === 'in' ? 'left' : 'right']: 0,
                  width: 7,
                  cursor: 'ew-resize',
                  background: 'rgba(255,255,255,.55)',
                  touchAction: 'none',
                }}
              />
            ))}
          </div>
        );
      }),
    [reel.timeline.clips, reel.assets, selectedClipId, drag, pct, onSelectClip]
  );

  const cues = useMemo(
    () =>
      reel.timeline.captions.map((cue) => {
        const moving = drag?.kind === 'cue' && drag.id === cue.id;
        return (
          <div
            key={cue.id}
            data-testid={`cue-${cue.id}`}
            onPointerDown={(e) => {
              onSelectCue(cue.id);
              begin({ kind: 'cue', id: cue.id, startX: e.clientX, dx: 0 }, e);
            }}
            title={`${cue.text} — drag to retime`}
            style={{
              position: 'absolute',
              left: pct(cue.start),
              width: pct(Math.max(0.08, cue.end - cue.start)),
              top: 3,
              bottom: 3,
              background: cue.hidden ? 'rgba(127,127,127,.35)' : '#111',
              color: '#fff',
              opacity: selectedCueId === cue.id ? 1 : 0.8,
              outline: selectedCueId === cue.id ? '2px solid #fff' : 'none',
              borderRadius: 3,
              fontSize: 10,
              lineHeight: '20px',
              padding: '0 4px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              cursor: 'grab',
              touchAction: 'none',
              transform: moving ? `translateX(${drag.dx}px)` : undefined,
              zIndex: moving ? 3 : 1,
            }}
          >
            {cue.text}
          </div>
        );
      }),
    [reel.timeline.captions, selectedCueId, drag, pct, onSelectCue]
  );

  const scrubFrom = (e: React.PointerEvent) => {
    // Seek on press, not on release: the playhead should be where you pointed
    // before you have finished moving.
    onSeek(timeAtX(e.clientX));
    begin({ kind: 'scrub', startX: e.clientX, dx: 0 }, e);
  };

  const ruler = useMemo(() => {
    const step = span <= 12 ? 2 : span <= 40 ? 5 : 10;
    const marks: number[] = [];
    for (let t = 0; t <= span; t += step) marks.push(t);
    return marks;
  }, [span]);

  return (
    // Wide reels scroll inside this box; the page itself must never scroll sideways.
    <div style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}>
      <div data-testid="reel-timeline" style={{ position: 'relative', userSelect: 'none', minWidth: 480 }}>
        <div style={{ position: 'relative', height: 14, fontSize: 10, color: 'var(--tl-tick, #9ca3af)' }}>
          {ruler.map((t) => (
            <span key={t} style={{ position: 'absolute', left: pct(t), transform: 'translateX(-50%)' }}>
              {t}s
            </span>
          ))}
        </div>

        <div
          ref={laneRef}
          data-testid="clip-lane"
          onPointerDown={scrubFrom}
          style={{
            position: 'relative',
            height: 44,
            background: 'rgba(127,127,127,.12)',
            borderRadius: 6,
            touchAction: 'none',
          }}
        >
          {clips}
        </div>

        <div
          data-testid="caption-lane"
          onPointerDown={scrubFrom}
          style={{
            position: 'relative',
            height: 26,
            marginTop: 6,
            background: 'rgba(127,127,127,.08)',
            borderRadius: 6,
            touchAction: 'none',
          }}
        >
          {cues}
        </div>

        <div
          data-testid="playhead"
          onPointerDown={scrubFrom}
          style={{
            position: 'absolute',
            left: pct(currentTime),
            top: 14,
            bottom: 0,
            width: 2,
            background: '#ff4d4f',
            cursor: 'ew-resize',
            touchAction: 'none',
            zIndex: 4,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: -5,
              left: -5,
              width: 12,
              height: 12,
              borderRadius: 3,
              background: '#ff4d4f',
            }}
          />
        </div>
      </div>
    </div>
  );
}
