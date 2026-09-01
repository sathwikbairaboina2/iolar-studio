import { run } from '../probe';

/**
 * The voice, mastered.
 *
 * Raw TTS lands at whatever level the model felt like, with rumble under it and sibilants
 * on top, and every reel sounded a little different from the last. What listeners read as
 * "professional" is mostly this chain: a floor cut, a gentle levelling of the loud and
 * quiet lines, the esses taken down, and the whole take brought to the loudness the
 * platforms expect — done here, at the source, so every cut, lipsync take and editor
 * project downstream inherits it.
 *
 * -16 LUFS is the voice-stem convention: it leaves headroom for a music bed and lands at
 * the -14 the platforms normalise to once mixed. True peak is held at -1.5 dB so the mp3
 * encode cannot clip what the wav did not.
 */
export const VOICE_LUFS = -16;
export const VOICE_TRUE_PEAK = -1.5;
export const VOICE_LRA = 11;

/**
 * What sits in front of the loudness pass, in order:
 * - highpass at 70 Hz: nothing a voice says lives below it, and TTS rumble does;
 * - a 2.5:1 compressor easing in above roughly -24 dB, so an emphatic line and a
 *   throwaway one sit in the same room;
 * - a de-esser, because TTS sibilants arrive sharpened and small speakers whistle.
 */
const SHAPE = 'highpass=f=70,acompressor=threshold=0.063:ratio=2.5:attack=8:release=120:makeup=2,deesser';

function loudnorm(extra = ''): string {
  return `loudnorm=I=${VOICE_LUFS}:TP=${VOICE_TRUE_PEAK}:LRA=${VOICE_LRA}${extra}:print_format=json`;
}

/** The measurements the first pass prints, fed back to the second. */
export function parseLoudness(stderr: string): Record<string, string> | null {
  // loudnorm prints its JSON block to stderr, after everything else ffmpeg had to say.
  const start = stderr.lastIndexOf('{');
  if (start < 0) return null;
  try {
    const data = JSON.parse(stderr.slice(start, stderr.indexOf('}', start) + 1));
    const keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
    if (keys.some((k) => typeof data[k] !== 'string')) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Masters `inPath` to `outPath` (48 kHz wav).
 *
 * Two passes, because single-pass loudnorm rides the gain as it goes and a voice pumped up
 * and down mid-sentence sounds worse than one merely quiet. The first pass measures; the
 * second applies one linear gain from those measurements, which is transparent. If the
 * measurement cannot be read back, the second pass runs dynamic rather than not at all — a
 * slightly pumped voice still beats an unlevelled one.
 */
export async function masterVoice(inPath: string, outPath: string): Promise<void> {
  const measure = await run('ffmpeg', [
    '-hide_banner', '-y', '-i', inPath,
    '-af', `${SHAPE},${loudnorm()}`,
    '-f', 'null', '-',
  ]);
  if (measure.code !== 0) throw new Error(`voice mastering measure failed: ${measure.stderr.slice(-300)}`);

  const m = parseLoudness(measure.stderr);
  const second = m
    ? loudnorm(
        `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
          `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      )
    : loudnorm();

  const apply = await run('ffmpeg', [
    '-hide_banner', '-y', '-i', inPath,
    '-af', `${SHAPE},${second}`,
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outPath,
  ]);
  if (apply.code !== 0) throw new Error(`voice mastering failed: ${apply.stderr.slice(-300)}`);
}
