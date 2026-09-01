import { promises as fs } from 'fs';
import path from 'path';
import { run } from '../probe';
import { beatSpans } from '../assemble';
import { reelAssetsDir, reelVoFile } from '@/lib/paths';
import type { Reel } from '../schema';

/**
 * Cutting one voiceover into one file per beat.
 *
 * Both renderers take audio per unit rather than per reel: the lipsync graph is
 * sized to the clip it is speaking, and `webpage-mp4` uses a page's audio
 * duration as that page's screen time. So a page stays on screen for exactly as
 * long as its line is spoken, which means the alignment does double duty — it
 * places the words, and it paces the footage.
 *
 * The spans come from `beatSpans`, which walks the aligned word timings the
 * whisper pass already stores on the reel. Nothing here re-transcribes.
 */

export function beatAudioDir(slug: string): string {
  return path.join(reelAssetsDir(slug), 'beat-audio');
}

export function beatAudioFile(slug: string, beatId: string): string {
  return path.join(beatAudioDir(slug), `${beatId}.wav`);
}

/** The audio a group of neighbouring beats is spoken over, cut as one continuous stretch. */
export function groupAudioFile(slug: string, key: string): string {
  return path.join(beatAudioDir(slug), `${key.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.wav`);
}

/** How far a cut may run past its last word, chasing the breath after it. */
const TAIL_MAX = 0.35;
/** Clearance kept before the next word, so a tail never clips its onset. */
const TAIL_CLEAR = 0.05;

/**
 * Where a cut should actually end: in the silence after the words, not on top of them.
 *
 * The aligned span ends at the instant the last word does, and a cut landing exactly there
 * clips the word's decay and the breath behind it — every bite ended with the sound of a
 * door closing. The cut runs on into the pause, stopping short of the next word's onset,
 * so the take breathes out the way the speaker did.
 */
export function tailEnd(
  words: { start: number; end: number }[],
  end: number,
  voiceEnd?: number
): number {
  // A word still sounding at the cut point means there is no silence to run into at all —
  // degenerate alignment, but a tail laid over someone talking is worse than none.
  if (words.some((w) => w.start < end - 1e-3 && w.end > end + 1e-3)) {
    return Math.round(end * 1e3) / 1e3;
  }
  const next = words.find((w) => w.start >= end - 1e-3);
  const room = next ? next.start - TAIL_CLEAR : voiceEnd ?? end + TAIL_MAX;
  return Math.round(Math.max(end, Math.min(end + TAIL_MAX, room)) * 1e3) / 1e3;
}

export type SliceOptions = {
  /** Word timings, so the cut can run out into the silence after its span. */
  words?: { start: number; end: number }[];
  /** Where the voiceover ends; a tail never runs past the file. */
  voiceEnd?: number;
  /**
   * Whether the length must land on the half-second grid.
   *
   * The lipsync renderer fails certain durations with an einops shape mismatch ("can't
   * divide axis of length 29640 in chunks of 18"); half-second lengths have not failed.
   * This used to be done by cutting the audio DOWN to the grid, which threw away up to
   * half a second of words — the ends of sentences, mostly. Now the cut keeps every word
   * and pads UP to the grid with silence instead. The real fix is still in the plugin's
   * own planner.
   */
  grid?: boolean;
};

/**
 * Cuts one stretch of the voiceover.
 *
 * A run of beats shown over the same picture is one request, so it is spoken over one piece
 * of audio: handing the renderer the beats separately is what produced four recordings of
 * the same document.
 */
export async function sliceSpan(
  slug: string,
  key: string,
  start: number,
  end: number,
  opts: SliceOptions = {}
): Promise<string> {
  const dir = beatAudioDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const dest = groupAudioFile(slug, key);

  // `?.length`, not truthiness: an unaligned reel hands over an empty array, and a tail
  // computed against no words at all would run into whatever the words would have said.
  const stops = opts.words?.length ? tailEnd(opts.words, end, opts.voiceEnd) : end;
  const asked = Math.max(0.5, stops - start);
  const padded = opts.grid ? Math.max(0.5, Math.ceil(asked * 2) / 2) : asked;

  const args = [
    '-y',
    '-ss', start.toFixed(3),
    '-t', asked.toFixed(3),
    '-i', reelVoFile(slug),
  ];
  // Padding is applied whenever the grid asks for it, even when the cut already measures
  // out: a span reaching past the end of the voiceover file comes back short from ffmpeg,
  // and the grid promise has to hold on what lands on disk, not on what was asked for.
  if (opts.grid) args.push('-af', `apad=whole_dur=${padded.toFixed(3)}`);
  args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest);
  await run('ffmpeg', args);
  return dest;
}

export class NoAlignmentError extends Error {}

/**
 * Writes one wav per beat and returns where each landed.
 *
 * Mono 16 kHz because that is what the lipsync graph's wav2vec2 encoder reads,
 * and it costs nothing for a page visit that only needs the duration. Beats with
 * no words — a title card — get no file and no entry; there is nothing to speak.
 */
export async function sliceBeatAudio(slug: string, reel: Reel): Promise<Record<string, string>> {
  if (!reel.vo.words.length) {
    throw new NoAlignmentError('the voiceover has not been aligned, so there are no word timings to cut on');
  }

  const spans = beatSpans(reel);
  const dir = beatAudioDir(slug);
  await fs.mkdir(dir, { recursive: true });

  const source = reelVoFile(slug);
  const out: Record<string, string> = {};

  for (const beat of reel.beats) {
    const span = spans.get(beat.id);
    if (!span) continue;
    const dest = beatAudioFile(slug, beat.id);
    const duration = Math.max(0.05, span.end - span.start);

    // -ss before -i seeks on the input, which is both faster and sample-accurate
    // enough here; re-encoding rather than copying because the cut has to land
    // mid-stream and a stream copy would snap to the nearest packet.
    await run('ffmpeg', [
      '-y',
      '-ss', span.start.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', source,
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      dest,
    ]);
    out[beat.id] = dest;
  }

  if (Object.keys(out).length === 0) {
    throw new NoAlignmentError('no beat matched the aligned words, so nothing could be cut');
  }
  return out;
}
