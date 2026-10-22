import { promises as fs } from 'fs';
import path from 'path';
import { extractJson } from '@/lib/ai/revise';
import { runProc } from '@/lib/explainer2/commands';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { tileFrames } from '@/lib/explainer2/strips';
import { launchDir, launchFile } from '@/lib/paths';
import type { LaunchProps } from './edit';
import {
  FRAMES_PER_SCENE,
  LAUNCH_CRITERIA, LAUNCH_MAX_ROUNDS, LAUNCH_PASS, LaunchCriticRecordSchema, LaunchCriticSchema, launchVerdict,
  type LaunchCritic, type LaunchCriticRecord, type LaunchCriticRound, type LaunchCriterion,
} from './rubric';
import type { Script } from './schema';

/**
 * The launch critic: a separate Opus call that can only Read. It looks at frames of every scene of the rendered mp4,
 * scores a launch-reel rubric, and lists fixes. The fixes go back to the edit list, never to code or to the script.
 */

export {
  LAUNCH_CRITERIA, LAUNCH_MAX_ROUNDS, LAUNCH_PASS, LaunchCriticRecordSchema, LaunchCriticSchema, launchVerdict,
  type LaunchCritic, type LaunchCriticRecord, type LaunchCriticRound, type LaunchCriterion,
};

/** The critic's fixes as notes for the edit list. */
export function launchCriticNotes(fixes: readonly string[], low: readonly string[]): string {
  return [
    `A reviewer watched the rendered reel and scored these below ${LAUNCH_PASS} out of 10: ${low.join(', ') || 'none'}. Change the edit list to apply every fix, keeping what already works. The script and the claims stay as they are:`,
    ...fixes.map((f) => `- ${f}`),
  ].join('\n');
}

/** `n` frames evenly spaced from 2 after the start of the scene to 2 before its end. */
export function sceneFrames(scene: { from: number; to: number }, n = FRAMES_PER_SCENE): number[] {
  const first = scene.from + 2;
  const last = Math.max(first, scene.to - 2);
  const frames = Array.from({ length: n }, (_, k) => first + Math.round((k * (last - first)) / (n - 1)));
  return frames.filter((f, i) => i === 0 || f !== frames[i - 1]);
}

export type StripFile = { scene: number; type: string; file: string };
export type StripDeps = {
  frame: (mp4: string, frame: number, fps: number, out: string) => Promise<void>;
  tile: (files: string[], out: string) => Promise<void>;
};

/** One frame out of an mp4 at half size (540 wide). */
export async function realFrame(mp4: string, frame: number, fps: number, out: string): Promise<void> {
  const r = await runProc('ffmpeg', ['-y', '-ss', String(frame / fps), '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-1', out], { timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`could not take frame ${frame} from the render: ${r.output.trim().slice(-300)}`);
}

export const realLaunchStripDeps = (): StripDeps => ({ frame: realFrame, tile: (files, out) => tileFrames(files, out) });

/** Writes `data/launch/<slug>/strips/<NN>-<type>.png`, one per scene, from the given mp4. The folder is cleared first. */
export async function launchStrips(slug: string, props: LaunchProps, mp4: string, deps: StripDeps): Promise<StripFile[]> {
  const dir = launchFile(slug, 'strips');
  const frames = path.join(dir, '_frames');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(frames, { recursive: true });
  const out: StripFile[] = [];
  try {
    for (const [i, scene] of props.scenes.entries()) {
      const nn = String(i).padStart(2, '0');
      const files: string[] = [];
      for (const [k, f] of sceneFrames(scene).entries()) {
        const file = path.join(frames, `${nn}-${k}.png`);
        await deps.frame(mp4, f, props.fps, file);
        files.push(file);
      }
      const strip = path.join(dir, `${nn}-${scene.type}.png`);
      await deps.tile(files, strip);
      out.push({ scene: i, type: scene.type, file: strip });
    }
  } finally {
    await fs.rm(frames, { recursive: true, force: true });
  }
  return out;
}

export type LaunchCriticInput = { script: Script; props: LaunchProps; strips: readonly StripFile[] };

/** The words spoken while a scene is on screen. */
function spoken(props: LaunchProps, scene: { from: number; to: number }): string {
  const words = props.timing.beats.flatMap((b) => b.words ?? []).filter((w) => w.startFrame >= scene.from && w.startFrame < scene.to);
  return words.map((w) => w.w).join(' ');
}

export function launchCriticPrompt(i: LaunchCriticInput): string {
  const strip = new Map(i.strips.map((s) => [s.scene, s.file]));
  const scenes = i.props.scenes.map((s, n) => {
    const secs = ((s.to - s.from) / i.props.fps).toFixed(1);
    return `- Scene ${n}, ${s.type}, ${secs} s (frames ${s.from}-${s.to}), says "${spoken(i.props, s) || '(nothing spoken)'}": ${strip.get(n) ?? '(no strip)'}`;
  });
  return [
    'You review a news reel about a tech launch: a short vertical video (1080 x 1920, 30 fps, 9:16). You can only Read files. You never edit anything.',
    `The headline of the reel is "${i.script.headline}" (kicker "${i.script.kicker}").`,
    'Below are strips: one png per scene, 6 frames evenly spaced from the start to the end of the scene, tiled three across (left to right, top to bottom, in time order), each frame 540 wide. Read every strip. Judge the motion from how the frames differ.',
    '',
    'Scenes, with the narration spoken during each and the strip file to Read:',
    ...scenes,
    '',
    `Score each item 0 to 10 as a whole number (10 is excellent; ${LAUNCH_PASS} is the pass mark):`,
    ...LAUNCH_CRITERIA.map((c, n) => `${n + 1}. ${c.key}: ${c.rule}`),
    '',
    `Then list the fixes that would raise any score below ${LAUNCH_PASS}: concrete changes to the edit list (which scene, which scene type to use instead, more or less weight, a scene to add or drop), at most 10, most important first, each under 300 characters. The scenes come from a fixed library and the words and numbers come from the approved script and claims, so do not ask for new wording or new facts. Leave the list empty when nothing is below ${LAUNCH_PASS}.`,
    '',
    `Return ONLY JSON, no prose, no fences: { "scores": { ${LAUNCH_CRITERIA.map((c) => `"${c.key}": number`).join(', ')} }, "fixes": [ string ] }`,
  ].join('\n');
}

/** One critique. A reply that fails validation is asked about once more with its own error quoted. */
export async function critiqueLaunch(deps: { run: ClaudeRun }, input: LaunchCriticInput): Promise<LaunchCritic> {
  const base = launchCriticPrompt(input);
  let prompt = base;
  let error = '';
  let said = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // The CLI reads files inside its working directory, and the strips live under the reel's folder.
    said = await deps.run(prompt, { model: 'opus', allowedTools: ['Read'], timeoutMs: 600_000, cwd: launchDir(input.props.slug) });
    try {
      return LaunchCriticSchema.parse(extractJson(said));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      prompt = `${base}\n\nYour previous answer was rejected: ${error.slice(0, 500)}\nReturn the corrected JSON only.`;
    }
  }
  throw new Error(`the critic did not return valid scores: ${error.slice(0, 300)}\nIt said: ${said.slice(0, 400)}`);
}

/** The loop: critique; if it fell short, one fix, then critique again; never more than two critiques. */
export async function launchCriticLoop(o: { critique: () => Promise<LaunchCritic>; fix: (fixes: string[], low: string[]) => Promise<void>; maxRounds?: number }): Promise<LaunchCriticRecord> {
  const max = Math.min(o.maxRounds ?? LAUNCH_MAX_ROUNDS, LAUNCH_MAX_ROUNDS);
  const rounds: LaunchCriticRound[] = [];
  let fixError: string | null = null;
  for (let i = 0; i < max; i++) {
    const c = await o.critique();
    const v = launchVerdict(c.scores);
    rounds.push({ ...c, pass: v.pass });
    if (v.pass || i === max - 1) break;
    try {
      await o.fix(c.fixes, v.low);
    } catch (err) {
      // A fix that cannot be made is not a broken reel: the render it would have replaced stands, and the reason is kept.
      fixError = (err instanceof Error ? err.message : String(err)).slice(0, 1200);
      break;
    }
  }
  const last = rounds[rounds.length - 1];
  return { pass: last.pass, scores: last.scores, fixes: last.fixes, rounds, ...(fixError ? { fixError } : {}) };
}
