'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { Pattern } from '@/lib/reel/pattern-schema';
import type { Reel } from '@/lib/reel/schema';
import { REEL_RATIOS } from '@/lib/reel/schema';
import { frameAt, timelineDuration } from '@/lib/reel/timeline';
import { motionCss, motionOriginCss } from '@/lib/reel/motion';
import { patternCssVars } from '@/lib/reel/pattern-schema';

export type PlayerProps = {
  reel: Reel;
  pattern: Pattern;
  slug: string;
  currentTime: number;
  playing: boolean;
  onTimeChange: (t: number) => void;
  onEnded?: () => void;
};

export function assetSrc(slug: string, assetId: string) {
  return `/api/reel/${slug}/assets?id=${encodeURIComponent(assetId)}`;
}

/**
 * Plays the timeline straight out of the DOM: no encode, instant scrub, and shots
 * appear as their jobs land. Motion and caption styling come from the same modules
 * the ffmpeg export uses, so what you watch here is what gets rendered.
 */
export default function Player({
  reel,
  pattern,
  slug,
  currentTime,
  playing,
  onTimeChange,
  onEnded,
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef<{ start: number; at: number }>({ start: 0, at: 0 });
  const [width, height] = REEL_RATIOS[reel.ratio];
  const duration = timelineDuration(reel.timeline) || reel.vo.durationSec;
  const frame = frameAt(reel.timeline, currentTime);
  const asset = frame.clip ? reel.assets.find((a) => a.id === frame.clip!.assetId) : undefined;
  const ready = asset?.status === 'ready' && !!asset.path;
  const [voFailed, setVoFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!playing) {
      audio?.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    // One clock per playback run: the voiceover when it plays, a monotonic timer otherwise.
    clockRef.current = { start: performance.now(), at: currentTime };
    if (audio) {
      audio.currentTime = currentTime;
      audio.play().catch(() => setVoFailed(true));
    }

    const step = () => {
      const now =
        audio && !voFailed && !audio.paused
          ? audio.currentTime
          : clockRef.current.at + (performance.now() - clockRef.current.start) / 1000;
      if (now >= duration) {
        onTimeChange(duration);
        onEnded?.();
        return;
      }
      onTimeChange(now);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // currentTime seeds the clock but must not restart the loop: the loop owns it while playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, voFailed, onTimeChange, onEnded]);

  // Keep the clip's own playhead matched to the timeline, tolerating small drift.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !frame.clip) return;
    const want = frame.clip.srcIn + (currentTime - frame.clip.start);
    if (Math.abs(video.currentTime - want) > 0.15) video.currentTime = Math.max(0, want);
    if (playing && video.paused) video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [currentTime, frame.clip, playing]);

  const transform = frame.clip ? motionCss(frame.clip.motion, frame.progress) : undefined;
  const transformOrigin = frame.clip ? motionOriginCss(frame.clip.motion) : undefined;
  const isStill = !!asset && asset.kind === 'image';

  return (
    <div
      data-testid="reel-stage"
      className="reel-stage"
      style={{
        position: 'relative',
        aspectRatio: `${width} / ${height}`,
        maxHeight: '72vh',
        margin: '0 auto',
        overflow: 'hidden',
        borderRadius: 12,
        // Caption and title sizes are container-relative, so the stage must be the container.
        containerType: 'size',
        background: frame.clip?.fit === 'contain' ? pattern.letterbox.bg : '#000',
        ...(Object.fromEntries(
          patternCssVars(pattern)
            .split('; ')
            .map((pair) => pair.split(': ') as [string, string])
        ) as React.CSSProperties),
      }}
    >
      {frame.clip && ready && !isStill && (
        <video
          key={frame.clip.assetId}
          ref={videoRef}
          data-testid="reel-video"
          data-asset={frame.clip.assetId}
          src={assetSrc(slug, frame.clip.assetId)}
          muted
          playsInline
          preload="auto"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: frame.clip.fit === 'contain' ? 'contain' : 'cover',
            transform,
            transformOrigin,
          }}
        />
      )}

      {frame.clip && ready && isStill && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-testid="reel-still"
          data-asset={frame.clip.assetId}
          src={assetSrc(slug, frame.clip.assetId)}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: frame.clip.fit === 'contain' ? 'contain' : 'cover',
            transform,
            transformOrigin,
          }}
        />
      )}

      {frame.clip && !ready && (
        <div
          data-testid="reel-pending"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 14,
            textAlign: 'center',
            padding: 24,
            background: 'repeating-linear-gradient(45deg,#1b1b1f,#1b1b1f 12px,#232329 12px,#232329 24px)',
          }}
        >
          {asset?.status === 'failed' || asset?.status === 'awaiting-manual'
            ? (asset.error ?? 'This shot needs a file')
            : 'generating this shot…'}
        </div>
      )}

      {frame.overlays.map((o) => (
        <div key={o.id} className="reel-hook-title" data-testid="reel-overlay">
          {String(o.props?.title ?? '')}
        </div>
      ))}

      {frame.captions.map((c) => (
        <div key={c.id} className="reel-caption" data-testid="reel-caption">
          <span>{c.text}</span>
        </div>
      ))}

      {reel.vo.durationSec > 0 && (
        <audio
          ref={audioRef}
          data-testid="reel-audio"
          src={`/api/reel/${slug}/vo`}
          preload="auto"
          onError={() => setVoFailed(true)}
        />
      )}
    </div>
  );
}
