import { z } from 'zod';

/**
 * The records of a designed explainer. Each one is a plain JSON file in `data/explainer-v2/<slug>/`, written
 * by one stage and read by the next, so a stage can be re-run on its own without the others.
 */

export const BriefSchema = z.object({
  topic: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(1).max(120),
  /** The one thing the viewer must take away. */
  claim: z.string().trim().min(1).max(300),
  seconds: z.number().int().min(20).max(45),
});
export type Brief = z.infer<typeof BriefSchema>;

export const ReadingSchema = z.object({
  value: z.number(),
  unit: z.string().max(12),
  label: z.string().min(1).max(40),
});
export type Reading = z.infer<typeof ReadingSchema>;

export const BeatSchema = z.object({
  id: z.string().regex(/^b\d+$/, 'beat ids are b1, b2, ...'),
  caption: z.string().min(1).max(80),
  narration: z.string().min(1).max(220),
  /** One sentence: what changes on screen. */
  visual: z.string().min(1).max(240),
  /** Numbers and key terms in the narration that the captions draw in the accent gradient. */
  emphasis: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
});
export type Beat = z.infer<typeof BeatSchema>;

export const ScriptSchema = z
  .object({
    title: z.string().min(1).max(40),
    hook: z.object({ before: ReadingSchema, after: ReadingSchema }),
    beats: z.array(BeatSchema).min(4).max(7),
    /** The specific claims and numbers the narration relies on, for the fact check. */
    facts: z.array(z.string().min(1).max(300)).max(16),
  })
  .refine((s) => new Set(s.beats.map((b) => b.id)).size === s.beats.length, { message: 'beat ids must be unique', path: ['beats'] });
export type Script = z.infer<typeof ScriptSchema>;

export const FactIssueSchema = z.object({
  /** The beat id the claim is in, or "facts" for a claim only listed there. */
  beat: z.string(),
  claim: z.string(),
  correction: z.string(),
});
export const FactCheckSchema = z.object({ ok: z.boolean(), issues: z.array(FactIssueSchema) });
export type FactCheck = z.infer<typeof FactCheckSchema>;

/** One spoken word, in absolute composition frames. */
export const TimedWordSchema = z.object({ w: z.string(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().nonnegative() });
export type TimedWord = z.infer<typeof TimedWordSchema>;

export const TimingSchema = z.object({
  fps: z.number().int().positive(),
  totalFrames: z.number().int().nonnegative(),
  beats: z.array(
    z.object({
      id: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      /** Frames the beat's voice clip plays (the beat runs a little longer). */
      voice: z.number().int().positive().optional(),
      /** The spoken words, for the word-synced captions. */
      words: z.array(TimedWordSchema).optional(),
      /** How the words were timed: whisper alignment, or an even spread when it was not available. */
      method: z.enum(['whisper', 'even']).optional(),
    }),
  ),
});
export type Timing = z.infer<typeof TimingSchema>;

export const STAGES = ['brief', 'script', 'factcheck', 'voice', 'design', 'gates', 'critic', 'render'] as const;
export type Stage = (typeof STAGES)[number];
export const STATUSES = ['pending', 'running', 'done', 'failed', 'blocked'] as const;
export type Status = (typeof STATUSES)[number];

const StageStateSchema = z.object({
  status: z.enum(STATUSES),
  at: z.string().optional(),
  error: z.string().optional(),
});
export type StageState = z.infer<typeof StageStateSchema>;

const JobBase = z.object({
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.object(Object.fromEntries(STAGES.map((s) => [s, StageStateSchema])) as Record<Stage, typeof StageStateSchema>),
  /** A person has accepted the fact-check issues that remain, so rendering is no longer blocked. */
  factOverride: z.boolean().default(false),
  /** Notes from the last revise, handed to the stage they apply to. */
  notes: z.string().default(''),
  /** The newest finished render's file name (a hash of what it was made from), if any. */
  renderId: z.string().nullable().default(null),
});
export type Job = z.infer<typeof JobBase>;

/** Jobs written before the critic stage existed have no `critic` entry: it counts as done once the render is, else pending. */
export const JobSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && 'stages' in raw) {
    const stages = (raw as { stages?: Record<string, { status?: string }> }).stages;
    if (stages && typeof stages === 'object' && !('critic' in stages)) {
      return { ...raw, stages: { ...stages, critic: { status: stages.render?.status === 'done' ? 'done' : 'pending' } } };
    }
  }
  return raw;
}, JobBase);

export function newJob(slug: string, now: string): Job {
  const stages = Object.fromEntries(STAGES.map((s) => [s, { status: s === 'brief' ? 'done' : 'pending' }])) as Job['stages'];
  return { slug, createdAt: now, updatedAt: now, stages, factOverride: false, notes: '', renderId: null };
}
