import { promises as fs } from 'fs';
import path from 'path';
import type { Proc } from '@/lib/explainer2/commands';
import type { VideoProvider } from '@/lib/reel/videoProvider';
import { launchAssetsDir, launchVoiceDir } from '@/lib/paths';
import { anchorPath, type Anchor } from './anchor';
import { HfUnreachable, type Hf } from './higgsfield';
import type { Timing } from './schema';
import { withBudget } from './spend';

/**
 * The anchor's talking clips. Every avatar scene is cut into parts of at most 15 s; each part is voiced by an audio slice of
 * the reel's own voice, so the lips match what the captions say. All parts are submitted together and waited on together.
 * A scene that Higgsfield cannot make (over budget, failed, timed out, unreachable) falls back to the free lip-sync
 * provider, and failing that to the still portrait.
 */

export const AVATAR_PROMPT =
  'The young man talks to camera like a creator filming a selfie video, lips matching the audio exactly, expressive eyebrows, natural blinks, small casual head movements. Same bedroom and lighting. No text, no cuts.';

/** Wan 2.7 takes whole-second durations of 2 to 15. Cost is about 1.5 credits per second. */
export const MIN_PART_SECONDS = 2;
const MAX_PART_SECONDS = 15;
const FPS = 30;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Seconds per clip: one clip up to 15 s, else equal parts of at most 15 s (34 s -> 11.33, 11.33, 11.34). */
export function clipPlan(frames: number): number[] {
  const total = round2(frames / FPS);
  const n = Math.max(1, Math.ceil(total / MAX_PART_SECONDS));
  if (n === 1) return [total];
  const each = round2(total / n);
  return [...Array(n - 1).fill(each), round2(total - each * (n - 1))];
}

/** The scene's audio, built from the beat voice clips it overlaps, each placed at its beat start, cut to [from, to] frames. */
export async function voiceSlice(slug: string, timing: Timing, from: number, to: number, out: string, proc: Proc): Promise<void> {
  const beats = timing.beats.filter((b) => b.start < to && b.start + (b.voice ?? b.end - b.start) > from);
  const args = ['-y'];
  const filters: string[] = [];
  beats.forEach((b, i) => {
    args.push('-i', path.join(launchVoiceDir(slug), `${b.id}.mp3`));
    const ms = Math.round((b.start / timing.fps) * 1000);
    filters.push(`[${i}]adelay=${ms}|${ms}[a${i}]`);
  });
  const seconds = (to - from) / timing.fps;
  const cut = `atrim=start=${round3(from / timing.fps)}:end=${round3(to / timing.fps)},asetpts=PTS-STARTPTS,apad=whole_dur=${round3(seconds)}`;
  if (!beats.length) {
    args.push('-f', 'lavfi', '-t', String(round3(seconds)), '-i', 'anullsrc=r=24000:cl=mono');
  } else if (beats.length === 1) {
    filters.push(`[a0]${cut}[o]`);
  } else {
    filters.push(`${beats.map((_b, i) => `[a${i}]`).join('')}amix=inputs=${beats.length}:normalize=0,${cut}[o]`);
  }
  if (beats.length) {
    // The filter graph goes in a file: runProc uses a shell on Windows, where | and [ ] in an argument are not safe.
    const script = `${out}.filter.txt`;
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(script, filters.join(';\n'));
    args.push('-/filter_complex', script, '-map', '[o]');
  }
  args.push('-t', String(round3(seconds)), out);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const r = await proc('ffmpeg', args, { timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`the voice slice failed: ${r.output.trim().slice(-300)}`);
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type AvatarScene = { id: string; from: number; to: number; layout: 'columnist' | 'photo' | 'split' };
export type AvatarClip = { file: string; source: 'higgsfield' | 'lipsync' | 'still' };
export type AvatarDeps = {
  hf: Hf;
  lipsync: VideoProvider | null;
  anchor: Anchor;
  timing: Timing;
  proc: Proc;
  http?: typeof fetch;
  /** Told once about anything the page should say, e.g. that Higgsfield was not reachable. */
  note?: (note: string) => void;
  sleep?: (ms: number) => Promise<unknown>;
};

type Part = { scene: AvatarScene; index: number; seconds: number; from: number; to: number; audio: string; job: string | null };

async function runFfmpeg(proc: Proc, args: string[], what: string): Promise<void> {
  const r = await proc('ffmpeg', ['-y', ...args], { timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error(`${what} failed: ${r.output.trim().slice(-300)}`);
}

/** Free fallback: the lip-sync desk makes the clip from the portrait and the scene's whole audio. */
async function viaLipsync(scene: AvatarScene, audio: string, dest: string, deps: AvatarDeps): Promise<boolean> {
  const lip = deps.lipsync;
  if (!lip) return false;
  try {
    if (!(await lip.available())) return false;
    const seconds = (scene.to - scene.from) / FPS;
    const { jobId } = await lip.animate({ audioPath: audio, imagePath: anchorPath(deps.anchor), seconds, seed: 1, ratio: '9:16', fps: FPS, brief: '' });
    const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < 240; i++) {
      const state = await lip.jobState(jobId);
      if (state === 'ready') { await lip.collect(jobId, dest); return true; }
      if (state === 'failed' || state === 'gone') return false;
      await sleep(5000);
    }
    return false;
  } catch {
    return false;
  }
}

export async function makeAvatarClips(slug: string, scenes: readonly AvatarScene[], deps: AvatarDeps): Promise<Record<string, AvatarClip>> {
  const dir = launchAssetsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const http = deps.http ?? fetch;
  const out: Record<string, AvatarClip> = {};
  const fine = new Set<string>();

  // 1. Every scene's audio, whole (for the fallback) and in parts (for Wan).
  const parts: Part[] = [];
  const wholeAudio: Record<string, string> = {};
  for (const scene of scenes) {
    wholeAudio[scene.id] = path.join(dir, `avatar-${scene.id}.mp3`);
    await voiceSlice(slug, deps.timing, scene.from, scene.to, wholeAudio[scene.id], deps.proc);
    let at = scene.from;
    const plan = clipPlan(scene.to - scene.from);
    for (let i = 0; i < plan.length; i++) {
      const to = i === plan.length - 1 ? scene.to : Math.min(scene.to, Math.round(at + plan[i] * FPS));
      const audio = plan.length === 1 ? wholeAudio[scene.id] : path.join(dir, `avatar-${scene.id}-${i + 1}.mp3`);
      if (plan.length > 1) await voiceSlice(slug, deps.timing, at, to, audio, deps.proc);
      parts.push({ scene, index: i + 1, seconds: plan[i], from: at, to, audio, job: null });
      at = to;
    }
  }

  // 2. Upload and submit all parts (each through the budget), then wait for all of them once.
  try {
    const media = new Map<Part, string>();
    for (const p of parts) media.set(p, await deps.hf.uploadFile(p.audio, 'audio/mpeg'));
    for (const p of parts) {
      const params = {
        kind: 'video', model: 'wan2_7',
        duration: Math.min(MAX_PART_SECONDS, Math.max(MIN_PART_SECONDS, Math.ceil(p.seconds))),
        resolution: '720p',
        aspect_ratio: '9:16',
        medias: [{ role: 'start_image', value: deps.anchor.startImage ?? deps.anchor.imageJobId }, { role: 'audio_references', value: media.get(p)! }],
        prompt: AVATAR_PROMPT,
      };
      p.job = await withBudget(slug, deps.hf, `avatar ${p.scene.id} part ${p.index}`, params, () => deps.hf.generateVideo(params));
    }
    const jobs = parts.flatMap((p) => (p.job ? [p.job] : []));
    const done = jobs.length ? await deps.hf.wait(jobs, 20 * 60_000) : {};

    // 3. Download, trim and join the parts of every scene whose parts all finished.
    for (const scene of scenes) {
      const mine = parts.filter((p) => p.scene === scene);
      if (!mine.every((p) => p.job && done[p.job]?.status === 'completed' && done[p.job].url)) continue;
      try {
        const trimmed: string[] = [];
        for (const p of mine) {
          const res = await http(done[p.job!].url!);
          if (!res.ok) throw new Error(`download ${res.status}`);
          const raw = path.join(dir, `avatar-${scene.id}-${p.index}.raw.mp4`);
          await fs.writeFile(raw, new Uint8Array(await res.arrayBuffer()));
          const cut = path.join(dir, `avatar-${scene.id}-${p.index}.mp4`);
          await runFfmpeg(deps.proc, ['-i', raw, '-t', String(p.seconds), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', cut], 'trimming an avatar clip');
          trimmed.push(cut);
        }
        const dest = path.join(dir, `avatar-${scene.id}.mp4`);
        if (trimmed.length === 1) await fs.copyFile(trimmed[0], dest);
        else {
          const list = path.join(dir, `avatar-${scene.id}.txt`);
          await fs.writeFile(list, trimmed.map((f) => `file '${path.basename(f)}'`).join('\n'));
          await runFfmpeg(deps.proc, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', dest], 'joining avatar clips');
        }
        out[scene.id] = { file: `avatar-${scene.id}.mp4`, source: 'higgsfield' };
        fine.add(scene.id);
      } catch {
        // falls through to the fallback below
      }
    }
  } catch (err) {
    if (!(err instanceof HfUnreachable)) throw err;
    deps.note?.(err.message);
  }

  // 4. Whatever Higgsfield did not make: lip-sync if it is up, else the still portrait.
  for (const scene of scenes) {
    if (fine.has(scene.id)) continue;
    const dest = path.join(dir, `avatar-${scene.id}.mp4`);
    out[scene.id] = (await viaLipsync(scene, wholeAudio[scene.id], dest, deps))
      ? { file: `avatar-${scene.id}.mp4`, source: 'lipsync' }
      : { file: '', source: 'still' };
  }
  return out;
}
