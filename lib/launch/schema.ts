import { z } from 'zod';
import { FactCheckSchema, TimingSchema, type FactCheck, type Timing } from '@/lib/explainer2/schema';

/**
 * The records of a launch reel. Each is a plain JSON file in `data/launch/<slug>/`, written by one stage and read by
 * the next, so any stage can be re-run on its own.
 */

export { FactCheckSchema, TimingSchema, type FactCheck, type Timing };

/** The launch arc, in the order a reel tells it. A script uses a subset, always in this order. */
export const ARC = ['hook', 'what', 'numbers', 'demo', 'who', 'catch', 'cta'] as const;
export type ArcBeat = (typeof ARC)[number];
const REQUIRED: readonly ArcBeat[] = ['hook', 'numbers', 'catch', 'cta'];

const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), 'links must be http(s)');

/** Official demo videos and X posts the user gave for this reel: links in, `{ id, url }` stored (demo-1.., post-1..). */
const linkList = (prefix: string) =>
  z
    .array(z.union([httpUrl, z.object({ id: z.string(), url: httpUrl })]))
    .max(3)
    .default([])
    .transform((items) => items.map((it, i) => (typeof it === 'string' ? { id: `${prefix}-${i + 1}`, url: it } : it)));

const BriefFields = {
  /** A working name for the launch, e.g. "Gemini 4". */
  title: z.string().trim().min(1).max(80),
  /** At least one link, unless a reference supplies the topic and research finds the official sources itself. */
  links: z.array(httpUrl).max(5),
  /** The tracked-channel reel this one answers: its topic and pacing, never its words. */
  reference: z.object({ id: z.string(), creator: z.string(), url: z.string(), topic: z.string(), hookSec: z.number(), medianShotSec: z.number() }).optional(),
  mode: z.enum(['faceless', 'avatar']).default('faceless'),
  speed: z.enum(['fast', 'polish']).default('fast'),
  seconds: z.number().int().min(30).max(60).default(45),
  /** Credits this reel may spend on Higgsfield. Not given: 120 for an avatar reel, 0 for a faceless one. */
  creditBudget: z.number().int().min(0).max(1000).optional(),
  demos: linkList('demo'),
  posts: linkList('post'),
};
/** The reel's look. A brief written before the field existed reads as the newsroom look; a new one defaults to the creator look. */
export const LOOKS = ['newsroom', 'creator'] as const;
export type Look = (typeof LOOKS)[number];
const withBudgetDefault = <T extends { mode: 'faceless' | 'avatar'; creditBudget?: number }>(b: T): T & { creditBudget: number } => ({
  ...b,
  creditBudget: b.creditBudget ?? (b.mode === 'avatar' ? 120 : 0),
});
export const BriefInputSchema = z
  .object({ ...BriefFields, look: z.enum(LOOKS).default('creator') })
  .refine((b) => b.links.length > 0 || b.reference !== undefined, { message: 'give at least one link', path: ['links'] })
  .transform(withBudgetDefault);
export type BriefInput = z.input<typeof BriefInputSchema>;
export const BriefSchema = z.object({ ...BriefFields, look: z.enum(LOOKS).optional(), createdAt: z.string() }).transform(withBudgetDefault);
export type Brief = z.infer<typeof BriefSchema>;

export const ClaimSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'claim ids are c1, c2, ...'),
  text: z.string().trim().min(1).max(300),
  /** Set only when the claim is one number (a price, a score, a size). */
  value: z.number().finite().optional(),
  unit: z.string().trim().max(12).optional(),
  url: httpUrl,
  /** Copied word for word from the page at `url`; the receipt highlights it there. */
  quote: z.string().trim().min(4).max(300),
});
export type Claim = z.infer<typeof ClaimSchema>;
export const ClaimsSchema = z
  .object({ claims: z.array(ClaimSchema).min(1).max(30) })
  .refine((c) => new Set(c.claims.map((x) => x.id)).size === c.claims.length, { message: 'claim ids must be unique', path: ['claims'] });
export type Claims = z.infer<typeof ClaimsSchema>;

const ScriptBeatSchema = z.object({
  id: z.enum(ARC),
  narration: z.string().trim().min(1).max(260),
  /** Words or short phrases copied from the narration that the captions draw in red. */
  emphasis: z.array(z.string().trim().min(1).max(40)).max(4).default([]),
  /** The claims this beat's narration relies on. */
  claims: z.array(z.string().regex(/^c\d+$/)).max(6).default([]),
});

const ScriptBase = z.object({
  /** The front-page headline of the hook, e.g. "Gemini 4 is here." */
  headline: z.string().trim().min(1).max(48),
  /** The kicker above it, e.g. "BREAKING". */
  kicker: z.string().trim().min(1).max(24),
  beats: z.array(ScriptBeatSchema).min(4).max(7),
});
export type Script = z.infer<typeof ScriptBase>;

/** The script schema for a reel whose claims have these ids. */
export function scriptSchemaFor(claimIds: readonly string[]) {
  const known = new Set(claimIds);
  return ScriptBase.superRefine((s, ctx) => {
    const ids = s.beats.map((b) => b.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['beats'], message: 'beat ids must be unique' });
    const order = ids.map((id) => ARC.indexOf(id));
    if (order.some((v, i) => i > 0 && v < order[i - 1])) {
      ctx.addIssue({ code: 'custom', path: ['beats'], message: `beats must follow the arc order: ${ARC.join(', ')}` });
    }
    for (const r of REQUIRED) if (!ids.includes(r)) ctx.addIssue({ code: 'custom', path: ['beats'], message: `the ${r} beat is required` });
    for (const b of s.beats) {
      for (const c of b.claims) if (!known.has(c)) ctx.addIssue({ code: 'custom', path: ['beats'], message: `beat ${b.id} cites ${c}, which is not a claim` });
    }
  });
}

export const STAGES = ['brief', 'research', 'script', 'factcheck', 'approve', 'voice', 'edit', 'assets', 'gates', 'render', 'critic'] as const;
export type Stage = (typeof STAGES)[number];
export const STATUSES = ['pending', 'running', 'done', 'failed', 'blocked'] as const;

const StageStateSchema = z.object({ status: z.enum(STATUSES), at: z.string().optional(), error: z.string().optional() });

const JobBase = z.object({
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.object(Object.fromEntries(STAGES.map((s) => [s, StageStateSchema])) as Record<Stage, typeof StageStateSchema>),
  /** A person approved the current script. Cleared whenever the script changes. */
  approved: z.boolean().default(false),
  /** A person accepted the fact-check issues that remain. */
  factOverride: z.boolean().default(false),
  /** Notes from the last revise, handed to the stage they apply to. */
  notes: z.string().default(''),
  /** The newest render's file name (a hash of what it was made from). */
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
  return { slug, createdAt: now, updatedAt: now, stages, approved: false, factOverride: false, notes: '', renderId: null };
}

/** What the assets stage made beyond the receipts: avatar clips, b-roll, demo clips and post cards, and where each came from. */
export const AssetSchema = z.object({
  kind: z.enum(['avatar', 'broll', 'demo', 'post']),
  /** `still` and `swapped` mean the stage could not make it and the reel shows a fallback instead; `refused` is a link that cannot be used. */
  source: z.enum(['higgsfield', 'lipsync', 'still', 'download', 'oembed', 'swapped', 'refused']),
  /** The file in assets/, or '' when there is none. */
  file: z.string(),
  /** What it was made from (frames and layout, a prompt, a url); a changed key is made again. */
  key: z.string(),
  reason: z.string().optional(),
  /** A demo clip's own pixel size, read from the trimmed file, so the reel can frame it at its aspect. */
  width: z.number().optional(),
  height: z.number().optional(),
  /** A moving b-roll clip's length, so the reel can slow it to fit its scene. */
  seconds: z.number().optional(),
  post: z.object({ author: z.string(), handle: z.string(), date: z.string(), text: z.string() }).optional(),
});
export type Asset = z.infer<typeof AssetSchema>;
export const AssetsSchema = z.object({ assets: z.record(z.string(), AssetSchema), notes: z.array(z.string()).default([]) });
export type Assets = z.infer<typeof AssetsSchema>;

/** Credits spent on Higgsfield by one reel (spend.json). Pure, so the reel page can use `spent`. */
export const SpendSchema = z.object({
  budget: z.number(),
  entries: z.array(z.object({
    at: z.string(),
    what: z.string(),
    credits: z.number(),
    balanceAfter: z.number().nullable(),
    outcome: z.enum(['spent', 'skipped-over-budget', 'failed', 'unknown']),
    /** Why a call failed or has no known outcome. */
    error: z.string().optional(),
  })),
});
export type Spend = z.infer<typeof SpendSchema>;
export type SpendEntry = Spend['entries'][number];

/** What a reel has spent: the calls that went through, and those whose outcome is not known (they may have been charged). */
export const spent = (s: Spend): number => s.entries.filter((e) => e.outcome === 'spent' || e.outcome === 'unknown').reduce((n, e) => n + e.credits, 0);
