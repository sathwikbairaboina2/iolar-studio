import { promises as fs } from 'fs';
import { Reel } from './schema';
import { loadReel, saveReel } from './store';
import { loadStyle } from './styles';
import { reelVoFile, reelWordsFile } from '../paths';
import { alignVoice } from './align';
import { speak } from './tts';
import { getSettings } from '../settings';
import { ffprobeMedia } from './probe';
import { scriptHashFor, voScriptFor } from './script';
import * as research from './research/store';

export { voScript } from './script';

/** The approved script when this is a pattern reel; null otherwise (a freeform reel voices its beats). */
async function scriptFor(slug: string, reel: Reel) {
  if (!reel.pattern) return null;
  return research.readScript(slug);
}

/** Alignment runs against whatever audio is on disk — TTS output or a creator's own recording. */
export async function alignExistingVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const audio = reelVoFile(slug);
  const info = await ffprobeMedia(audio);
  const script = await scriptFor(slug, reel);
  const words = await alignVoice(audio, voScriptFor(reel, script));
  await fs.writeFile(reelWordsFile(slug), JSON.stringify(words, null, 2));
  const next: Reel = {
    ...reel,
    // Stamped with the script it was made from, so a beat revised afterwards is visible
    // rather than silently cut against audio of the old words.
    vo: { ...reel.vo, file: 'vo.mp3', durationSec: info.durationSec, words, scriptHash: scriptHashFor(reel, script) },
  };
  await saveReel(slug, next);
  return next;
}

/**
 * Speaks the script and aligns it.
 *
 * The engine comes from `voiceProvider`, and every one of them is local — the voiceover
 * is synthesised on this machine and no audio reaches a paid service.
 */
export async function synthesizeVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const script = voScriptFor(reel, await scriptFor(slug, reel));
  const { provider: used } = await speak(script, reelVoFile(slug));
  await saveReel(slug, { ...reel, vo: { ...reel.vo, provider: 'local', voiceId: used } });

  // The audio is on disk before alignment runs, so a whisper failure never loses the voiceover.
  return alignExistingVoice(slug);
}
