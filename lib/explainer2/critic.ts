import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { extractJson } from '@/lib/ai/revise';
import { CRITERIA, CriticSchema, PASS_SCORE, verdict, type Critic, type CriterionKey } from './rubric';
import type { Script, Timing } from './schema';
import type { ClaudeRun } from './script';
import type { Strip } from './strips';
import { renderRoot } from './workspace';

/**
 * The critic: a separate Opus call that can only Read. It scores the motion strips against a rubric and says what to fix.
 * A video whose scores are not all 8 or better gets one more design round with the fixes, then one more critique.
 */

export const MAX_ROUNDS = 2;
/** The only tool the critic has: it looks, it cannot edit. */
export const CRITIC_TOOLS = ['Read'];

export { CRITERIA, CriticSchema, PASS_SCORE, verdict, type Critic };

export type CriticRound = Critic & { pass: boolean };
export type CriticRecord = { pass: boolean; scores: Critic['scores']; fixes: string[]; rounds: CriticRound[] };

/** critic.json: the final scores and fixes, and every round that led to them. */
export const CriticRecordSchema = z.object({
  pass: z.boolean(),
  scores: CriticSchema.shape.scores,
  fixes: z.array(z.string()),
  rounds: z.array(CriticSchema.extend({ pass: z.boolean() })),
});

/** The loop: critique; if it fell short, one design round with the fixes, then critique again; never more than `maxRounds` critiques. */
export async function critiqueLoop(o: { critique: () => Promise<Critic>; fix: (fixes: string[], low: CriterionKey[]) => Promise<void>; maxRounds?: number }): Promise<CriticRecord> {
  const max = o.maxRounds ?? MAX_ROUNDS;
  const rounds: CriticRound[] = [];
  for (let i = 0; i < max; i++) {
    const c = await o.critique();
    const v = verdict(c.scores);
    rounds.push({ ...c, pass: v.pass });
    if (v.pass || i === max - 1) break;
    await o.fix(c.fixes, v.low);
  }
  const last = rounds[rounds.length - 1];
  return { pass: last.pass, scores: last.scores, fixes: last.fixes, rounds };
}

/** The critic's fixes as notes for the designer. */
export function criticNotes(fixes: readonly string[], low: readonly string[]): string {
  return [
    `A reviewer looked at the motion strips (the files named below) and scored these below ${PASS_SCORE} out of 10: ${low.join(', ') || 'none'}. Apply every fix, keeping what already works:`,
    ...fixes.map((f) => `- ${f}`),
  ].join('\n');
}

export type CriticInput = { script: Script; timing: Timing; strips: readonly Strip[]; references: readonly string[] };

export function criticPrompt(i: CriticInput): string {
  const beats = i.script.beats.map((b) => `${b.id}: says "${b.narration}" / should show: ${b.visual}`).join('\n');
  return [
    'You are the critic of a short vertical explainer video (1080 x 1920, 30 fps, 9:16). You can only Read files. You never edit anything.',
    'Below are motion strips: one png per beat, 6 frames evenly spaced from the first to the last frame of the beat, tiled three across (left to right, top to bottom, in time order), each frame 540 x 960. Read every strip. Judge the motion from how the frames differ.',
    '',
    'Motion strips:',
    ...i.strips.map((s) => `- ${s.beat}: ${s.file}`),
    '',
    i.references.length ? 'Reference frames of the aiiolar look (Read them to compare):' : 'There are no reference frames yet; judge the look from the strips alone (a deep violet ground, dark rounded cards, pink and purple accents).',
    ...i.references.map((r) => `- ${r}`),
    '',
    'What each beat says and should show:',
    beats,
    '',
    `Timing: ${i.timing.totalFrames} frames at ${i.timing.fps} fps, beats at ${i.timing.beats.map((b) => `${b.id}=${b.start}-${b.end}`).join(', ')}.`,
    '',
    'Score each item 1 to 10 (10 is excellent; 8 is the pass mark):',
    ...CRITERIA.map((c, n) => `${n + 1}. ${c.key}: ${c.rule}`),
    '',
    'Then list the fixes that would raise any score below 8: concrete changes to the design (which beat, what to move or enlarge or animate), at most 8, most important first. Leave it empty when nothing is below 8.',
    '',
    `Return ONLY JSON, no prose, no fences: { "scores": { ${CRITERIA.map((c) => `"${c.key}": number`).join(', ')} }, "fixes": [ string ] }`,
  ].join('\n');
}

export type CriticDeps = { run: ClaudeRun; root?: string };

/** The reference frames the kit ships, as absolute paths. */
async function referenceFrames(root: string): Promise<string[]> {
  const dir = path.join(root, 'src', 'designed', 'reference');
  try {
    return (await fs.readdir(dir)).filter((f) => /\.png$/i.test(f)).sort().map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** One critique. A reply that fails validation is asked about once more with its own error quoted. */
export async function critique(deps: CriticDeps, input: { script: Script; timing: Timing; strips: readonly Strip[] }): Promise<Critic> {
  const root = deps.root ?? renderRoot();
  const base = criticPrompt({ ...input, references: await referenceFrames(root) });
  let prompt = base;
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const said = await deps.run(prompt, { model: 'opus', cwd: root, allowedTools: CRITIC_TOOLS, timeoutMs: 15 * 60_000 });
    try {
      return CriticSchema.parse(extractJson(said));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      prompt = `${base}\n\nYour previous answer was rejected: ${error.slice(0, 500)}\nReturn the corrected JSON only.`;
    }
  }
  throw new Error(`the critic did not return valid scores: ${error.slice(0, 300)}`);
}
