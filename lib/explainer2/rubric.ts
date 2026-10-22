import { z } from 'zod';

/** The critic's rubric and score shapes. Plain data and zod, so the page can import them as well as the server. */

export const PASS_SCORE = 8;
export const CRITERIA = [
  { key: 'hook', rule: 'The hook moves in the first second, and its number is big.' },
  { key: 'readable', rule: 'Everything is readable on a phone (at least 40 px at the 1080 x 1920 reference).' },
  { key: 'motion', rule: 'Nothing is static for more than 2 seconds.' },
  { key: 'emphasis', rule: 'The right thing is emphasised in each beat.' },
  { key: 'clean', rule: 'There is no overlap or clipping, and no beat\'s layout shows through the next one.' },
  { key: 'look', rule: 'It matches the aiiolar look (compare with the reference frames).' },
  { key: 'match', rule: 'What is on screen matches the narration, and a beat\'s visual changes when its narration starts, not seconds later.' },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]['key'];

const Score = z.number().min(1).max(10);
export const CriticSchema = z.object({
  scores: z.object(Object.fromEntries(CRITERIA.map((c) => [c.key, Score])) as Record<CriterionKey, typeof Score>),
  fixes: z.array(z.string().min(1).max(500)).max(12),
});
export type Critic = z.infer<typeof CriticSchema>;

/** Passes only when every score is at least 8; `low` names the criteria that fell short. */
export function verdict(scores: Critic['scores']): { pass: boolean; low: CriterionKey[] } {
  const low = CRITERIA.map((c) => c.key).filter((k) => scores[k] < PASS_SCORE);
  return { pass: low.length === 0, low };
}
