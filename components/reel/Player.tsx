'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/** How many shots ahead are kept loading off-screen. */
const PRELOAD_AHEAD = 3;

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
  /** Every mounted lane, so the ones that are not on screen can be held still. */
  const laneRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const laneCallbacks = useRef<Map<string, (el: HTMLVideoElement | null) => void>>(new Map());
  /**
   * One ref callback per asset, kept for the life of the component.
   *
   * An inline `ref={(el) => ...}` is a new function on every render, and React answers that
   * by calling the previous one with null — so anything doing cleanup there runs on every
   * render rather than on unmount. Pausing from such a callback stopped the shot being
   * watched sixty times a second.
   */
  const laneRefFor = useCallback((assetId: string) => {
    const held = laneCallbacks.current.get(assetId);
    if (held) return held;
    const fn = (el: HTMLVideoElement | null) => {
      if (el) laneRefs.current.set(assetId, el);
      else {
        laneRefs.current.get(assetId)?.pause();
        laneRefs.current.delete(assetId);
      }
    };
    laneCallbacks.current.set(assetId, fn);
    return fn;
  }, []);
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef<{ start: number; at: number }>({ start: 0, at: 0 });
  // The studio re-creates these arrows on every render, and the loop calls onTimeChange every
  // frame. Reading them through a ref keeps a playback run alive across those renders: as deps
  // they tore the clock down each frame, re-seeking the voiceover back to a stale timestamp.
  const onTimeChangeRef = useRef(onTimeChange);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
    onEndedRef.current = onEnded;
  });
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
        onTimeChangeRef.current(duration);
        onEndedRef.current?.();
        return;
      }
      onTimeChangeRef.current(now);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // currentTime seeds the clock but must not restart the loop: the loop owns it while playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, voFailed]);

  // Keep the clip's own playhead matched to the timeline, tolerating small drift.
  useEffect(() => {
    if (!frame.clip) return;
    const video = laneRefs.current.get(frame.clip.assetId) ?? null;
    videoRef.current = video;
    if (!video) return;
    const raw = Math.max(0, frame.clip.srcIn + (currentTime - frame.clip.start));
    // The export feeds every video input through -stream_loop -1, so a clip that runs past
    // the end of its footage wraps back to the top there. Wrap here too: clamping instead
    // parks the element on its last frame, and — since the drift never closes — asks for a
    // fresh seek on every animation frame, which freezes the picture and pins a core.
    const src = video.duration;
    const looped = Number.isFinite(src) && src > 0;
    const want = looped ? raw % src : raw;
    const gap = Math.abs(video.currentTime - want);
    const drift = looped ? Math.min(gap, src - gap) : gap;
    if (drift > 0.15) video.currentTime = want;
    if (playing && video.paused) video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();

    // A lane that is no longer on screen must be held still. Left running it plays on behind
    // the shot you are watching, and since these elements loop it never stops — one decoder
    // per clip the reel has been through, all of them competing for the same frames.
    for (const [assetId, el] of laneRefs.current) {
      if (assetId !== frame.clip.assetId) el.pause();
    }
  }, [currentTime, frame.clip, playing]);

  const transform = frame.clip ? motionCss(frame.clip.motion, frame.progress) : undefined;
  const transformOrigin = frame.clip ? motionOriginCss(frame.clip.motion) : undefined;
  const isStill = !!asset && asset.kind === 'image';

  // The shots after this one, mounted off-screen and keyed by asset so each cut promotes the
  // very element that has been loading. Mounting a fresh <video> at the cut instead cost a
  // tenth to a quarter of a second of black on every one of them.
  //
  // Three deep, not one: a reel cut to the voiceover runs about 1.8 seconds a clip, and one
  // clip of runway left the player asking for bytes it needed immediately — twenty-one
  // stalls in half a minute of playback.
  const clips = reel.timeline.clips;
  const clipIndex = frame.clip ? clips.indexOf(frame.clip) : -1;
  const upcoming: string[] = [];
  if (clipIndex >= 0) {
    for (const c of clips.slice(clipIndex + 1)) {
      if (c.assetId === frame.clip!.assetId || upcoming.includes(c.assetId)) continue;
      const asset = reel.assets.find((a) => a.id === c.assetId);
      if (!asset || asset.status !== 'ready' || !asset.path || asset.kind === 'image') continue;
      upcoming.push(c.assetId);
      if (upcoming.length >= PRELOAD_AHEAD) break;
    }
  }

  const lanes: { assetId: string; current: boolean }[] = [];
  if (frame.clip && ready && !isStill) lanes.push({ assetId: frame.clip.assetId, current: true });
  for (const id of upcoming) lanes.push({ assetId: id, current: false });

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
      {lanes.map((lane) => (
        <video
          key={lane.assetId}
          ref={laneRefFor(lane.assetId)}
          data-testid={lane.current ? 'reel-video' : 'reel-preload'}
          data-asset={lane.assetId}
          src={assetSrc(slug, lane.assetId)}
          muted
          playsInline
          preload="auto"
          // Footage shorter than its clip loops in the export; let the element do the same
          // rather than firing ended and sitting on a frozen last frame. Only the shot on
          // screen needs it — a lane that is merely loading has nothing to wrap.
          loop={lane.current}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: frame.clip?.fit === 'contain' ? 'contain' : 'cover',
            transform: lane.current ? transform : undefined,
            transformOrigin: lane.current ? transformOrigin : undefined,
            opacity: lane.current ? 1 : 0,
            pointerEvents: 'none',
          }}
        />
      ))}

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
