import { ScriptSchema, type Script } from './schema';

/**
 * How long a script may run. The voice speaks about 2.5 words a second, so a brief of N seconds gets N x 2.5 words.
 * The first drafts of the first four videos ran 30 to 50% over, so the limit is enforced twice: the schema rejects a
 * script over 115% of the budget, and a video whose measured length is over 115% of the brief gets one rewrite.
 */
export const WORDS_PER_SECOND = 2.5;
export const OVER = 1.15;
/** The hook beat is the opener, about 4 seconds spoken. */
export const HOOK_WORD_LIMIT = 16;
/** Rewrites of a script because the finished voice ran long. */
export const MAX_REWRITES = 1;
/** Kokoro's speed for explainers (the reel default of 1.35 is for a different style). */
export const EXPLAINER_SPEED = 1.08;

export const wordBudget = (seconds: number): number => Math.floor(seconds * WORDS_PER_SECOND);
export const maxWords = (seconds: number): number => Math.floor(wordBudget(seconds) * OVER);
export const maxVideoSeconds = (seconds: number): number => seconds * OVER;

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
export const scriptWords = (script: Pick<Script, 'beats'>): number => script.beats.reduce((n, b) => n + countWords(b.narration), 0);

/** The script schema for a brief of `seconds`: the usual rules plus the word limit. */
export function scriptSchemaFor(seconds: number) {
  return ScriptSchema.superRefine((s, ctx) => {
    const n = scriptWords(s);
    if (n > maxWords(seconds)) {
      ctx.addIssue({
        code: 'custom',
        path: ['beats'],
        message: `the narration has ${n} words; the budget for ${seconds} seconds is ${wordBudget(seconds)} (never more than ${maxWords(seconds)})`,
      });
    }
  });
}

/** Whether the finished voice runs long enough to rewrite the script, and to how many words. */
export function trimDecision(o: { measuredSeconds: number; seconds: number; words: number; rewrites: number }): { trim: boolean; targetWords?: number } {
  if (o.rewrites >= MAX_REWRITES || !(o.measuredSeconds > maxVideoSeconds(o.seconds))) return { trim: false };
  const scaled = Math.floor(o.words * (o.seconds / o.measuredSeconds));
  return { trim: true, targetWords: Math.max(10, Math.min(wordBudget(o.seconds), scaled)) };
}

/** The revision note for the rewrite. */
export const cutNotes = (targetWords: number): string =>
  `The finished voiceover runs too long. Cut to ${targetWords} words of narration in total (keep the hook beat within ${HOOK_WORD_LIMIT} words). Shorten sentences and drop the least important detail; keep the claim and every number it relies on.`;
