import { promises as fs } from 'fs';
import path from 'path';
import { explainer2File, explainer2VoiceDir } from '@/lib/paths';
import { EXPLAINER_SPEED } from './budget';
import type { Script, Timing } from './schema';
import { computeTiming } from './timing';
import { alignBeat, type AlignDeps } from './words';

export type VoiceDeps = AlignDeps & {
  /** `lib/reel/tts speak`: text to an mp3 at the path, at the given Kokoro speed. */
  speak: (text: string, mp3Path: string, opts?: { speed?: number }) => Promise<unknown>;
  /** The clip's length in seconds. */
  probe: (file: string) => Promise<number>;
  /** Kokoro speed; defaults to the explainer pace (1.08). */
  speed?: number;
  fps?: number;
};

/**
 * Speaks every beat's narration to voice/<id>.mp3, measures the clips, aligns each clip to its words (whisper, or an even
 * spread when that is not available) and writes timing.json: the beat frames, how long each voice clip plays, and the
 * spoken words in absolute frames for the word-synced captions.
 */
export async function speakBeats(slug: string, script: Script, deps: VoiceDeps): Promise<Timing> {
  const dir = explainer2VoiceDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const fps = deps.fps ?? 30;
  const clips: { id: string; seconds: number }[] = [];
  const files: string[] = [];
  for (const beat of script.beats) {
    const file = path.join(dir, `${beat.id}.mp3`);
    await deps.speak(beat.narration, file, { speed: deps.speed ?? EXPLAINER_SPEED });
    const seconds = await deps.probe(file);
    if (!(seconds > 0)) throw new Error(`the voice clip for ${beat.id} has no length`);
    clips.push({ id: beat.id, seconds });
    files.push(file);
  }
  const base = computeTiming(clips, fps);
  const beats: Timing['beats'] = [];
  for (let i = 0; i < base.beats.length; i++) {
    const b = base.beats[i];
    const voice = Math.max(1, Math.ceil(clips[i].seconds * fps));
    const { words, method } = await alignBeat({ text: script.beats[i].narration, mp3: files[i], beatStart: b.start, voiceFrames: voice, fps, align: deps.align });
    beats.push({ ...b, voice, words, method });
  }
  const timing: Timing = { fps: base.fps, totalFrames: base.totalFrames, beats };
  await fs.writeFile(explainer2File(slug, 'timing.json'), JSON.stringify(timing, null, 2));
  return timing;
}
