import { promises as fs } from 'fs';
import { Reel } from './schema';
import { loadReel, saveReel } from './store';
import { loadPattern } from './patterns';
import { reelVoFile, reelWordsFile } from '../paths';
import { alignVoice } from './align';
import { downloadTo, hfGenerateAudio } from '../higgsfield/client';
import { ffprobeMedia } from './probe';

export function voScript(reel: Reel): string {
  return reel.beats.map((b) => b.text.trim()).join(' ');
}

/** Alignment runs against whatever audio is on disk — TTS output or a creator's own recording. */
export async function alignExistingVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const audio = reelVoFile(slug);
  const info = await ffprobeMedia(audio);
  const words = await alignVoice(audio, voScript(reel));
  await fs.writeFile(reelWordsFile(slug), JSON.stringify(words, null, 2));
  const next: Reel = {
    ...reel,
    vo: { ...reel.vo, file: 'vo.mp3', durationSec: info.durationSec, words },
  };
  await saveReel(slug, next);
  return next;
}

export async function synthesizeVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const { url } = await hfGenerateAudio({
    text: voScript(reel),
    voiceId: pattern.voice.higgsfieldVoiceId,
  });
  await downloadTo(url, reelVoFile(slug));
  // The audio is on disk before alignment runs, so a whisper failure never loses the voiceover.
  await saveReel(slug, {
    ...reel,
    vo: { ...reel.vo, provider: 'higgsfield', voiceId: pattern.voice.higgsfieldVoiceId },
  });
  return alignExistingVoice(slug);
}
