import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { getSettings } from '../settings';
import { Word } from './schema';
import { run } from './probe';

export class WhisperUnavailableError extends Error {
  constructor() {
    super('Whisper is not installed. Run `npm run setup:whisper`.');
    this.name = 'WhisperUnavailableError';
  }
}

function scriptPath() {
  return path.join(process.cwd(), 'scripts', 'align.py');
}

export async function whisperAvailable(): Promise<boolean> {
  const { whisperPython } = getSettings();
  try {
    await fs.access(whisperPython);
    const { code } = await run(whisperPython, ['-c', 'import whisper'], { timeoutMs: 120_000 });
    return code === 0;
  } catch {
    return false;
  }
}

export function parseAlignOutput(stdout: string): { text: string; words: Word[] } {
  // Belt and braces: if anything else reaches stdout, take the last JSON object on it.
  const raw = stdout.trim();
  const start = raw.indexOf('{');
  const data = JSON.parse(start > 0 ? raw.slice(start) : raw);
  const words: Word[] = (data.words ?? []).map((w: Word) => ({
    w: String(w.w),
    start: Number(w.start),
    end: Number(w.end),
  }));
  if (!words.length) throw new Error('alignment returned no words');
  return { text: String(data.text ?? ''), words };
}

async function callWhisper(audioPath: string, prompt: string): Promise<{ text: string; words: Word[] }> {
  if (!(await whisperAvailable())) throw new WhisperUnavailableError();
  const s = getSettings();
  const child = spawn(s.whisperPython, [scriptPath(), audioPath, s.whisperModel, s.whisperDevice], {
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdin.write(prompt);
  child.stdin.end();
  const code: number = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', (c) => res(c ?? -1));
  });
  if (code !== 0) throw new Error(`whisper exited ${code}: ${stderr.slice(-400)}`);
  return parseAlignOutput(stdout);
}

/**
 * Names and odd spellings from the script, as a decoder hint.
 *
 * Only the vocabulary, never the script itself: whisper treats a long initial_prompt as
 * text it has already transcribed and silently skips the matching opening seconds
 * (measured: 40 words returned instead of 46, losing the first 2s).
 */
export function vocabHint(script: string): string {
  const seen = new Set<string>();
  for (const raw of script.split(/\s+/)) {
    const token = raw.replace(/^[^\w]+|[^\w]+$/g, '');
    if (token.length < 2) continue;
    const interesting = /[A-Z0-9]/.test(token.slice(1)) || /^[A-Z]/.test(token);
    if (interesting) seen.add(token);
    if (seen.size >= 24) break;
  }
  return [...seen].join(', ');
}

/** Product names align instead of being guessed, without losing the opening line. */
export function alignVoice(audioPath: string, script: string): Promise<Word[]> {
  return callWhisper(audioPath, vocabHint(script)).then((r) => r.words);
}

export function transcribe(audioPath: string): Promise<{ text: string; words: Word[] }> {
  return callWhisper(audioPath, '');
}
