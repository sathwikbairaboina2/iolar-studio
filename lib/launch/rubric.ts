import { z } from 'zod';

/** The launch critic's rubric and record shapes. Plain data and zod, so the reel page can import them as well as the server. */

export const LAUNCH_MAX_ROUNDS = 2;
export const LAUNCH_PASS = 8;
export const FRAMES_PER_SCENE = 6;

export const LAUNCH_CRITERIA = [
  { key: 'hook', rule: 'In the first 2 seconds the headline states the change and something moves.' },
  { key: 'readable', rule: 'Every text is readable on a phone (at least 40 px at 1080 x 1920) and nothing is clipped.' },
  { key: 'receipts', rule: 'Each receipt shows its highlighted words clearly, and its source can be read.' },
  { key: 'numbers', rule: 'Every number on screen matches what the narration says at that moment.' },
  { key: 'pacing', rule: 'No scene sits still for more than 4 seconds, and cuts land with the words they illustrate.' },
  { key: 'clean', rule: 'Nothing overlaps; captions never cover a headline, a figure or a highlighted quote.' },
  { key: 'look', rule: 'It reads as one editorial newsroom piece: paper, serif headlines, grain, red used only for what matters.' },
] as const;
export type LaunchCriterion = (typeof LAUNCH_CRITERIA)[number]['key'];

const Score = z.number().int().min(0).max(10);
export const LaunchCriticSchema = z.object({
  scores: z.object(Object.fromEntries(LAUNCH_CRITERIA.map((c) => [c.key, Score])) as Record<LaunchCriterion, typeof Score>),
  fixes: z.array(z.string().min(1).max(300)).max(10),
});
export type LaunchCritic = z.infer<typeof LaunchCriticSchema>;

export type LaunchCriticRound = LaunchCritic & { pass: boolean };
/** critic.json: the final scores and fixes, and every round that led to them. */
export const LaunchCriticRecordSchema = z.object({
  pass: z.boolean(),
  scores: z.record(z.string(), z.number()),
  fixes: z.array(z.string()),
  rounds: z.array(LaunchCriticSchema.extend({ pass: z.boolean() })),
  /** Why the last round's fixes could not be applied; the render before them was kept. */
  fixError: z.string().optional(),
});
export type LaunchCriticRecord = z.infer<typeof LaunchCriticRecordSchema>;

/** Passes only when every score is at least 8; `low` names the criteria that fell short. */
export function launchVerdict(scores: Record<string, number>): { pass: boolean; low: string[] } {
  const low = LAUNCH_CRITERIA.map((c) => c.key as string).filter((k) => !(scores[k] >= LAUNCH_PASS));
  return { pass: low.length === 0, low };
}
