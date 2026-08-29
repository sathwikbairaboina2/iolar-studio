import { promises as fs } from 'fs';
import path from 'path';
import { getSettings } from '../settings';
import { run } from './probe';

export class TtsUnavailableError extends Error {
  constructor(detail: string) {
    super(`No voiceover engine available: ${detail}`);
    this.name = 'TtsUnavailableError';
  }
}

export type TtsProvider = 'kokoro' | 'piper' | 'sapi' | 'manual';

/**
 * Local text-to-speech.
 *
 * ComfyUI has no offline speech model on this machine — every TTS node it exposes is a
 * paid cloud API — so the voiceover is synthesised outside it and stays on this box:
 *
 * - `kokoro`: an 82M ONNX model, the most natural of the three and the one that reads at
 *   a presenter's pace rather than rushing
 * - `piper`: smaller and faster, noticeably flatter
 * - `sapi`: the voice built into Windows, no install at all, plainly robotic
 *
 * Each writes a wav, which ffmpeg turns into the mp3 the reel stores.
 */

export function kokoroPaths() {
  const s = getSettings();
  const dir = path.isAbsolute(s.kokoroDir) ? s.kokoroDir : path.join(process.cwd(), s.kokoroDir);
  return {
    python: s.whisperPython,
    model: path.join(dir, 'kokoro-v1.0.onnx'),
    voices: path.join(dir, 'voices-v1.0.bin'),
    voice: s.kokoroVoice,
    speed: s.kokoroSpeed,
  };
}

export async function kokoroAvailable(): Promise<boolean> {
  const { python, model, voices } = kokoroPaths();
  try {
    await fs.access(model);
    await fs.access(voices);
    await fs.access(python);
    const { code } = await run(python, ['-c', 'import kokoro_onnx'], { timeoutMs: 180_000 });
    return code === 0;
  } catch {
    return false;
  }
}

async function synthKokoro(text: string, wavPath: string): Promise<void> {
  const { python, model, voices, voice, speed } = kokoroPaths();
  const script = path.join(process.cwd(), 'scripts', 'kokoro_tts.py');
  const { spawn } = await import('child_process');
  const child = spawn(python, [script, wavPath, model, voices, voice, String(speed)], {
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdin.write(text);
  child.stdin.end();
  const code: number = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', (c) => res(c ?? -1));
  });
  if (code !== 0) throw new Error(`kokoro exited ${code}: ${stderr.slice(-300)}`);
}

export function piperPaths() {
  const s = getSettings();
  return {
    python: s.whisperPython,
    voice: s.piperVoice,
    dataDir: path.isAbsolute(s.piperDataDir)
      ? s.piperDataDir
      : path.join(process.cwd(), s.piperDataDir),
  };
}

export async function piperAvailable(): Promise<boolean> {
  const { python, voice, dataDir } = piperPaths();
  try {
    await fs.access(path.join(dataDir, `${voice}.onnx`));
    const { code } = await run(python, ['-c', 'import piper'], { timeoutMs: 120_000 });
    return code === 0;
  } catch {
    return false;
  }
}

async function synthPiper(text: string, wavPath: string): Promise<void> {
  const { python, voice, dataDir } = piperPaths();
  const { spawn } = await import('child_process');
  const child = spawn(python, ['-m', 'piper', '-m', voice, '--data-dir', dataDir, '-f', wavPath], {
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdin.write(text);
  child.stdin.end();
  const code: number = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', (c) => res(c ?? -1));
  });
  if (code !== 0) throw new Error(`piper exited ${code}: ${stderr.slice(-300)}`);
}

/** Windows' own synthesiser. Always present, so it is the last resort before failing. */
async function synthSapi(text: string, wavPath: string): Promise<void> {
  const script = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    '$s.Rate = 1;',
    `$s.SetOutputToWaveFile(${JSON.stringify(wavPath)});`,
    '$text = [Console]::In.ReadToEnd();',
    '$s.Speak($text);',
    '$s.Dispose();',
  ].join(' ');
  const { spawn } = await import('child_process');
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdin.write(text);
  child.stdin.end();
  const code: number = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', (c) => res(c ?? -1));
  });
  if (code !== 0) throw new Error(`sapi exited ${code}: ${stderr.slice(-300)}`);
}

async function toMp3(wavPath: string, mp3Path: string): Promise<void> {
  await fs.mkdir(path.dirname(mp3Path), { recursive: true });
  const { code, stderr } = await run('ffmpeg', [
    '-v', 'error', '-y', '-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '192k', mp3Path,
  ]);
  if (code !== 0) throw new Error(`voiceover encode failed: ${stderr.slice(0, 300)}`);
}

/** Speaks the script to `mp3Path`, returning which engine actually produced it. */
export async function speak(text: string, mp3Path: string): Promise<{ provider: TtsProvider }> {
  if (!text.trim()) throw new TtsUnavailableError('the script is empty');
  const configured = getSettings().voiceProvider as TtsProvider;
  const wav = mp3Path.replace(/\.mp3$/i, '.wav');
  await fs.mkdir(path.dirname(wav), { recursive: true });

  const order: TtsProvider[] =
    configured === 'manual' ? []
    : configured === 'sapi' ? ['sapi']
    : configured === 'piper' ? ['piper', 'sapi']
    : ['kokoro', 'piper', 'sapi'];

  const problems: string[] = [];
  for (const provider of order) {
    try {
      if (provider === 'kokoro') {
        if (!(await kokoroAvailable())) {
          problems.push('kokoro: model files missing (npm run setup:voice)');
          continue;
        }
        await synthKokoro(text, wav);
      } else if (provider === 'piper') {
        if (!(await piperAvailable())) {
          problems.push('piper: not installed (npm run setup:voice)');
          continue;
        }
        await synthPiper(text, wav);
      } else {
        await synthSapi(text, wav);
      }
      await toMp3(wav, mp3Path);
      await fs.unlink(wav).catch(() => {});
      return { provider };
    } catch (err) {
      problems.push(`${provider}: ${String(err).slice(0, 160)}`);
    }
  }

  throw new TtsUnavailableError(
    problems.length ? problems.join('; ') : 'voiceProvider is "manual" — drop a vo.mp3 in yourself'
  );
}
