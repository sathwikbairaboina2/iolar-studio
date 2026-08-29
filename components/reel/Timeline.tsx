'use client';
import React from 'react';
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
};

const STATUS_TINT: Record<string, string> = {
  ready: 'var(--tl-ready, #3b82f6)',
  running: 'var(--tl-running, #a855f7)',
  queued: 'var(--tl-queued, #6b7280)',
  failed: 'var(--tl-failed, #ef4444)',
  'awaiting-manual': 'var(--tl-manual, #f59e0b)',
};

/** Clip lane over caption lane, both on one time axis, with a draggable playhead. */
export default function Timeline({
  reel,
  currentTime,
  selectedClipId,
  selectedCueId,
  onSeek,
  onSelectClip,
  onSelectCue,
}: TimelineProps) {
  const duration = timelineDuration(reel.timeline) || reel.vo.durationSec || 1;
  const pct = (t: number) => `${(t / duration) * 100}%`;

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, ((e.clientX - box.left) / box.width) * duration)));
  };

  return (
    <div data-testid="reel-timeline" style={{ position: 'relative', userSelect: 'none' }}>
      <div
        data-testid="clip-lane"
        onClick={seekFromEvent}
        style={{ position: 'relative', height: 44, background: 'rgba(127,127,127,.12)', borderRadius: 6 }}
      >
        {reel.timeline.clips.map((clip) => {
          const asset = reel.assets.find((a) => a.id === clip.assetId);
          return (
            <div
              key={clip.id}
              data-testid={`clip-${clip.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectClip(clip.id);
              }}
              title={`${clip.id} · ${clip.motion.type} · ${(clip.end - clip.start).toFixed(2)}s`}
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
                cursor: 'pointer',
              }}
            >
              {clip.locked ? '🔒 ' : ''}
              {clip.motion.type}
            </div>
          );
        })}
      </div>

      <div
        data-testid="caption-lane"
        onClick={seekFromEvent}
        style={{ position: 'relative', height: 26, marginTop: 6, background: 'rgba(127,127,127,.08)', borderRadius: 6 }}
      >
        {reel.timeline.captions.map((cue) => (
          <div
            key={cue.id}
            data-testid={`cue-${cue.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCue(cue.id);
            }}
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
              cursor: 'pointer',
            }}
          >
            {cue.text}
          </div>
        ))}
      </div>

      <div
        data-testid="playhead"
        style={{
          position: 'absolute',
          left: pct(currentTime),
          top: 0,
          bottom: 0,
          width: 2,
          background: '#ff4d4f',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
