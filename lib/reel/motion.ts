import { Clip } from './schema';

export type Motion = Clip['motion'];
export type MotionFrame = { scale: number; tx: number; ty: number };

/**
 * The single definition of what a motion does at a given progress (0..1).
 * tx/ty are fractions of the frame, applied after scaling. Both the DOM preview
 * and the ffmpeg export read this, so they cannot drift apart.
 */
export function motionScaleAt(m: Motion, progress: number): MotionFrame {
  const p = Math.min(1, Math.max(0, progress));
  const s = m.strength;
  switch (m.type) {
    case 'zoom-in':
      return { scale: 1 + s * p, tx: 0, ty: 0 };
    case 'zoom-out':
      return { scale: 1 + s * (1 - p), tx: 0, ty: 0 };
    case 'pan-left':
      return { scale: 1 + s, tx: s / 2 - s * p, ty: 0 };
    case 'pan-right':
      return { scale: 1 + s, tx: -s / 2 + s * p, ty: 0 };
    case 'hold':
    default:
      return { scale: 1, tx: 0, ty: 0 };
  }
}

function round(n: number) {
  return Math.round(n * 1e5) / 1e5;
}

/** Preview side. */
export function motionCss(m: Motion, progress: number): string {
  const f = motionScaleAt(m, progress);
  return `scale(${round(f.scale)}) translate(${round(f.tx * 100)}%, ${round(f.ty * 100)}%)`;
}

export function motionOriginCss(m: Motion): string {
  return `${round(m.origin[0] * 100)}% ${round(m.origin[1] * 100)}%`;
}

/**
 * Export side. zoompan with d=1 passes each input frame through with its own zoom,
 * which is the reliable way to Ken Burns a video — plain scale cannot vary with time.
 */
export function motionFfmpeg(
  m: Motion,
  opts: { fps: number; frames: number; width: number; height: number }
): string {
  const { fps, frames, width, height } = opts;
  const n = Math.max(1, frames - 1);
  const start = motionScaleAt(m, 0);
  const end = motionScaleAt(m, 1);
  const still = m.type === 'hold' || m.strength === 0;
  const z = still ? `'1'` : `'${round(start.scale)}+(${round(end.scale - start.scale)})*on/${n}'`;
  const panPerFrame = round((end.tx - start.tx) / n);
  const x = still
    ? `'(iw-iw/zoom)*${round(m.origin[0])}'`
    : `'(iw-iw/zoom)*${round(m.origin[0])}+(${round(start.tx)}+${panPerFrame}*on)*iw'`;
  const y = `'(ih-ih/zoom)*${round(m.origin[1])}'`;
  return `zoompan=z=${z}:x=${x}:y=${y}:d=1:s=${width}x${height}:fps=${fps}`;
}
