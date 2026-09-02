import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { speak } from '@/lib/reel/tts';

/**
 * The studio records the plugin's lines with its own voice stack (kokoro first, piper,
 * then SAPI, mastered) and hands the recordings back with the text they were read from.
 * One file per beat: the plugin measures each and cuts the slide to it.
 */

export type Line = { beatId: string; text: string };
export type RecordedLine = Line & { audio: { format: 'mp3'; base64: string } };

export type Speaker = (text: string, mp3Path: string) => Promise<{ provider: string }>;

export async function recordLines(
  lines: Line[],
  opts: { speaker?: Speaker; onLine?: (beatId: string, provider: string) => void } = {},
): Promise<{ lines: RecordedLine[]; provider: string | null }> {
  const speaker = opts.speaker ?? speak;
  const dir = await mkdtemp(join(tmpdir(), 'iolar-jobs-voice-'));
  let provider: string | null = null;
  const out: RecordedLine[] = [];
  try {
    for (const l of lines) {
      if (!l.text.trim()) continue;
      const mp3 = join(dir, `${l.beatId}.mp3`);
      const r = await speaker(l.text.trim(), mp3);
      provider = r.provider;
      opts.onLine?.(l.beatId, r.provider);
      out.push({ beatId: l.beatId, text: l.text.trim(), audio: { format: 'mp3', base64: (await readFile(mp3)).toString('base64') } });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { lines: out, provider };
}
