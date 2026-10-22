import { promises as fs } from 'fs';
import path from 'path';
import type { Hf } from './higgsfield';
import { HfUnreachable } from './higgsfield';
import { withBudget } from './spend';

/** The voice of a launch reel: Higgsfield's qwen TTS in a young Indian creator's register, with Kokoro as the fallback. */

export const QWEN_VOICE_ID = '6f98d3dd-324f-4845-8c28-c1d1647a06cd';
export const QWEN_INSTRUCTION = 'Young Indian English accent, 21-year-old creator, fast, energetic, casual, excited';

export const qwenParams = (text: string) => ({
  kind: 'audio',
  model: 'qwen_audio_tts',
  prompt: text,
  voice_type: 'preset',
  voice_id: QWEN_VOICE_ID,
  instruction: QWEN_INSTRUCTION,
  language: 'en',
  speech_rate: 1.15,
  format: 'mp3',
});

/** The frame by which the first word must be spoken in the creator look: a hook that waits for its voice loses the scroll. */
export const MAX_FIRST_WORD_FRAME = 3;

/** An error text when the first beat's first word starts after frame 3, else null. Timings without word times pass. */
export function speechStartError(timing: { beats: { words?: { startFrame: number }[] }[] }): string | null {
  const at = timing.beats[0]?.words?.[0]?.startFrame;
  if (at === undefined || at <= MAX_FIRST_WORD_FRAME) return null;
  return `speech starts at frame ${at}; the first line must start within ${MAX_FIRST_WORD_FRAME} frames, so the first voice clip has leading silence: voice it again`;
}

export type Speak = (text: string, mp3Path: string, opts?: { speed?: number; voice?: string }) => Promise<unknown>;

/** A `speak` for `speakBeats`: one budgeted generate_audio call per line, waited on, downloaded to the mp3 path. */
export function hfSpeak(hf: Hf, slug: string, http: typeof fetch = fetch): (text: string, mp3Path: string) => Promise<void> {
  return async (text, mp3Path) => {
    const params = qwenParams(text);
    const job = await withBudget(slug, hf, 'voice line', params, () => hf.generateAudio(params));
    if (!job) throw new Error('Higgsfield did not make the voice line');
    const r = (await hf.wait([job], 5 * 60_000))[job];
    if (r?.status !== 'completed' || !r.url) throw new Error('the voice line did not finish');
    const res = await http(r.url);
    if (!res.ok) throw new Error(`the voice line could not be fetched (${res.status})`);
    await fs.mkdir(path.dirname(mp3Path), { recursive: true });
    await fs.writeFile(mp3Path, new Uint8Array(await res.arrayBuffer()));
  };
}

/**
 * Tries `primary` for each line; when Higgsfield is unreachable or a line fails, that line (and every later one, so the
 * voice does not flip back and forth) is spoken by `fallback`, and `note` is told once.
 */
export function withKokoroFallback(
  primary: (text: string, mp3Path: string) => Promise<unknown>,
  fallback: Speak,
  kokoro: { voice: string; speed: number },
  note: (n: string) => void,
): Speak {
  let fellBack = false;
  return async (text, mp3Path) => {
    if (!fellBack) {
      try {
        await primary(text, mp3Path);
        return;
      } catch (err) {
        fellBack = true;
        const why = err instanceof HfUnreachable ? 'Higgsfield was not reachable' : `a Higgsfield voice line failed (${(err instanceof Error ? err.message : String(err)).slice(0, 100)})`;
        note(`${why}; the voice fell back to Kokoro (${kokoro.voice})`);
      }
    }
    await fallback(text, mp3Path, kokoro);
  };
}
