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

/**
 * Cuts one stretch of the voiceover.
 *
 * A run of beats shown over the same picture is one request, so it is spoken over one piece
 * of audio: handing the renderer the beats separately is what produced four recordings of
 * the same document.
 */
export async function sliceSpan(slug: string, key: string, start: number, end: number): Promise<string> {
  const dir = beatAudioDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const dest = groupAudioFile(slug, key);
  await run('ffmpeg', [
    '-y',
    '-ss', start.toFixed(3),
    '-t', Math.max(0.05, end - start).toFixed(3),
    '-i', reelVoFile(slug),
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    dest,
  ]);
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
