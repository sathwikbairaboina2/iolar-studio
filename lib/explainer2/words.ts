import type { TimedWord } from './schema';

/** What the whisper aligner returns for a clip: each word with its start and end in seconds from the clip's start. */
export type HeardWord = { w: string; start: number; end: number };

/** Seconds from the clip's start to absolute composition frames. The clip plays from `beatStart`, so that is where its zero is. */
export function wordsToFrames(words: readonly HeardWord[], beatStart: number, fps: number, maxFrames?: number): TimedWord[] {
  const limit = maxFrames === undefined ? Infinity : beatStart + maxFrames;
  const out: TimedWord[] = [];
  let prev = beatStart;
  for (const h of words) {
    const startFrame = Math.min(limit - 1, Math.max(prev, beatStart + Math.round(h.start * fps)));
    const endFrame = Math.min(limit, Math.max(startFrame + 1, beatStart + Math.round(h.end * fps)));
    out.push({ w: h.w, startFrame, endFrame });
    prev = startFrame;
  }
  return out;
}

/** The fallback when alignment is not available: the narration's words spread evenly over the clip. */
export function evenWords(text: string, beatStart: number, voiceFrames: number): TimedWord[] {
  const ws = text.split(/\s+/).filter(Boolean);
  return ws.map((w, i) => ({
    w,
    startFrame: beatStart + Math.round((i * voiceFrames) / ws.length),
    endFrame: beatStart + Math.round(((i + 1) * voiceFrames) / ws.length),
  }));
}

/** Shows the script's own spelling ("P95", "90%") on the timings that were heard, when the two have the same number of words. */
export function mergeScriptWords(heard: readonly TimedWord[], narration: string): TimedWord[] {
  const script = narration.split(/\s+/).filter(Boolean);
  if (script.length !== heard.length) return [...heard];
  return heard.map((h, i) => ({ ...h, w: script[i] }));
}

export type AlignDeps = {
  /** `lib/reel/align alignVoice`: the clip and its script in, timed words out. */
  align?: (mp3: string, text: string) => Promise<HeardWord[]>;
};

/** One beat's words in absolute frames, from whisper when it works and otherwise an even spread. `method` records which. */
export async function alignBeat(o: AlignDeps & { text: string; mp3: string; beatStart: number; voiceFrames: number; fps: number }): Promise<{ words: TimedWord[]; method: 'whisper' | 'even' }> {
  if (o.align) {
    try {
      const heard = await o.align(o.mp3, o.text);
      if (heard.length) return { words: mergeScriptWords(wordsToFrames(heard, o.beatStart, o.fps, o.voiceFrames), o.text), method: 'whisper' };
    } catch {
      // Whisper missing or failed: the even spread below keeps the captions on screen.
    }
  }
  return { words: evenWords(o.text, o.beatStart, o.voiceFrames), method: 'even' };
}
