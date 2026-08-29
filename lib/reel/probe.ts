import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export type MediaInfo = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

/** ffmpeg/ffprobe/python are real executables: never spawn them through a shell. */
export function run(
  bin: string,
  args: string[],
  opts: { onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const { code } = await run('ffmpeg', ['-version'], { timeoutMs: 15_000 });
    return code === 0;
  } catch {
    return false;
  }
}

export async function ffprobeMedia(file: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate',
    file,
  ]);
  const data = JSON.parse(stdout || '{}');
  const streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] =
    data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const [num, den] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    durationSec: Number(data.format?.duration ?? 0),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: den ? num / den : 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Timestamps where the picture changes enough to count as a cut. */
export async function sceneCuts(file: string, threshold = 0.3): Promise<number[]> {
  const { stderr, stdout } = await run('ffmpeg', [
    '-v', 'info',
    '-i', file,
    '-filter_complex', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-f', 'null', '-',
  ]);
  const times: number[] = [];
  for (const m of `${stdout}${stderr}`.matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(m[1]));
  return [...new Set(times)].sort((a, b) => a - b);
}

export async function extractFrames(
  file: string,
  times: number[],
  outDir: string,
  width?: number
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const out: string[] = [];
  for (const [i, t] of times.entries()) {
    const dest = path.join(outDir, `f${String(i + 1).padStart(3, '0')}.png`);
    const args = ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1'];
    if (width) args.push('-vf', `scale=${width}:-1`);
    args.push(dest);
    const { code, stderr } = await run('ffmpeg', args);
    if (code !== 0) throw new Error(`frame extract at ${t}s failed: ${stderr.slice(0, 200)}`);
    out.push(dest);
  }
  return out;
}

/**
 * Samples frames at a fixed rate in ONE ffmpeg pass, optionally cropping first.
 * Per-frame `-ss` seeks cost a process each; this is the difference between
 * two seconds and two minutes when walking a whole reel.
 */
export async function sampleFrames(
  file: string,
  outDir: string,
  opts: { fps: number; width?: number; crop?: { w: number; h: number; x: number; y: number } }
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const chain: string[] = [];
  if (opts.crop) chain.push(`crop=${opts.crop.w}:${opts.crop.h}:${opts.crop.x}:${opts.crop.y}`);
  chain.push(`fps=${opts.fps}`);
  if (opts.width) chain.push(`scale=${opts.width}:-1`);

  const { code, stderr } = await run('ffmpeg', [
    '-v', 'error', '-y', '-i', file, '-vf', chain.join(','), path.join(outDir, 'f%04d.png'),
  ]);
  if (code !== 0) throw new Error(`frame sampling failed: ${stderr.slice(0, 300)}`);
  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
  return files.map((f) => path.join(outDir, f));
}

/** Synthetic clip so tests need no binary fixtures in git. */
export async function makeTestClip(
  outPath: string,
  opts: { seconds: number; width: number; height: number; fps: number; audio: boolean }
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const args = [
    '-v', 'error', '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${opts.width}x${opts.height}:rate=${opts.fps}:duration=${opts.seconds}`,
  ];
  if (opts.audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.seconds}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(opts.seconds));
  if (opts.audio) args.push('-c:a', 'aac', '-shortest');
  args.push(outPath);
  const { code, stderr } = await run('ffmpeg', args);
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(0, 300)}`);
}
