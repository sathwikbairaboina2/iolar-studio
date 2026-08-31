import { z } from 'zod';
import { SourceClassSchema } from './brief';
import { canonicalizeUrl, candidateId } from './url';

export const SCORE_WEIGHTS = {
  relevance: 0.3,
  authority: 0.2,
  recency: 0.15,
  uniqueness: 0.15,
  usability: 0.2,
} as const;

const scoreValue = z.number().int().min(0).max(5);

export const ScoresSchema = z
  .object({
    relevance: scoreValue,
    authority: scoreValue,
    recency: scoreValue,
    uniqueness: scoreValue,
    usability: scoreValue,
  })
  .strict();

export type Scores = z.infer<typeof ScoresSchema>;
export type Verdict = "keep" | "maybe" | "reject";

export function scoreTotal(scores: Scores): number {
  const weighted =
    scores.relevance * SCORE_WEIGHTS.relevance +
    scores.authority * SCORE_WEIGHTS.authority +
    scores.recency * SCORE_WEIGHTS.recency +
    scores.uniqueness * SCORE_WEIGHTS.uniqueness +
    scores.usability * SCORE_WEIGHTS.usability;
  return Math.round((weighted / 5) * 100);
}

export function verdictFor(total: number): Verdict {
  if (total >= 70) return "keep";
  if (total >= 45) return "maybe";
  return "reject";
}

export const CandidateSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{12}$/),
    sourceClass: SourceClassSchema,
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    title: z.string().min(1),
    publisher: z.string().min(1),
    author: z.string().nullable(),
    publishedAt: z.string().datetime().nullable(),
    retrievedAt: z.string().datetime(),
    thumbnailUrl: z.string().url().nullable(),
    durationSec: z.number().positive().nullable(),
    summary: z.string().min(1).max(280),
    pullQuotes: z.array(z.object({ text: z.string().min(1), context: z.string() }).strict()).max(3),
    stats: z.array(z.object({ value: z.string(), unit: z.string(), claim: z.string() }).strict()).max(5),
    assetKind: z.enum(["broll", "screenshot", "quote", "data", "repo", "doc"]),
    clipWindow: z
      .object({ startSec: z.number().min(0), endSec: z.number().min(0), why: z.string().min(1) })
      .strict()
      .refine((c) => c.endSec > c.startSec, { message: "clipWindow endSec must be after startSec" })
      .nullable(),
    whyItMatters: z.string().min(1),
    scores: ScoresSchema,
    scoreTotal: z.number().int().min(0).max(100),
    verdict: z.enum(["keep", "maybe", "reject"]),
    rejectReason: z.string().nullable(),
    dupeOf: z.string().nullable(),
    hunterAgent: z.string().min(1),
    fetchPlan: z
      .object({
        method: z.enum(["yt-dlp", "http", "gh", "none"]),
        target: z.string(),
        note: z.string().nullable(),
      })
      .strict(),
    risk: z
      .object({ paywall: z.boolean(), licence: z.string().nullable(), unstable: z.boolean() })
      .strict(),
  })
  .strict()
  .refine((c) => c.verdict !== "reject" || (c.rejectReason?.length ?? 0) > 0, {
    message: "rejectReason is required when verdict is reject",
    path: ["rejectReason"],
  });

export type Candidate = z.infer<typeof CandidateSchema>;

export const CandidatesFileSchema = z
  .object({
    runId: z.string().min(1),
    generatedAt: z.string().datetime(),
    criticVersion: z.string(),
    stats: z
      .object({
        // zod 4 wants the key schema stated; reelscout is on zod 3 where it was implied.
        perClass: z.record(
          z.string(),
          z.object({ found: z.number().int(), kept: z.number().int(), rejected: z.number().int() }).strict(),
        ),
        totalFound: z.number().int(),
        totalKept: z.number().int(),
        dupesCollapsed: z.number().int(),
      })
      .strict(),
    candidates: z.array(CandidateSchema),
  })
  .strict();

export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;

export function parseCandidates(raw: unknown): CandidatesFile {
  const parsed = CandidatesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`candidates.json: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return parsed.data;
}

/**
 * Gives every candidate an id derived from its canonical URL.
 *
 * The critic is a language model and its ids were its own invention: asked for
 * twelve hex characters it mostly complied, and the one time it did not the
 * whole pack failed validation at the write — thirteen minutes of searching
 * gone for a field the server can compute exactly. `candidateId` already
 * existed for this and nothing called it.
 *
 * `dupeOf` points at ids the model assigned, so it is remapped through the same
 * table rather than left dangling. Two rows on one canonical URL are the same
 * source, but they still get distinct ids: an id shared by two rows makes every
 * pointer to it ambiguous.
 */
export function withStableIds(candidates: Candidate[]): Candidate[] {
  const remap = new Map<string, string>();
  const taken = new Set<string>();

  const withIds = candidates.map((c) => {
    let base: string;
    try {
      base = candidateId(canonicalizeUrl(c.canonicalUrl || c.url));
    } catch {
      // An unparseable URL is still a source worth keeping; hash what it says.
      base = candidateId(String(c.canonicalUrl || c.url));
    }

    let id = base;
    for (let n = 1; taken.has(id); n += 1) id = candidateId(`${base}#${n}`);
    taken.add(id);
    if (c.id) remap.set(c.id, id);
    return { ...c, id };
  });

  return withIds.map((c) => ({
    ...c,
    dupeOf: c.dupeOf ? remap.get(c.dupeOf) ?? null : null,
  }));
}

export type SiftedCandidates = { kept: Candidate[]; dropped: { index: number; issue: string }[] };

/**
 * Keeps the candidates that validate and reports the ones that do not.
 *
 * Three live runs died at the write because one row in thirty had a field the
 * model shaped wrong — `stats.perClass` as numbers, an id that was not twelve
 * hex, a `clipWindow` as an array. Each time the whole pack went, along with
 * every minute spent finding it.
 *
 * A critic that misjudges one source has not invalidated the other twenty-nine.
 * So a bad row is dropped and counted rather than fatal; the caller surfaces the
 * count, because sources silently vanishing is its own kind of wrong. Only a
 * reply where nothing validates is an error — that is a model that misunderstood
 * the question, not a model that fumbled a field.
 */
export function siftCandidates(raw: unknown[]): SiftedCandidates {
  const kept: Candidate[] = [];
  const dropped: { index: number; issue: string }[] = [];

  raw.forEach((row, index) => {
    const parsed = CandidateSchema.safeParse(row);
    if (parsed.success) {
      kept.push(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    dropped.push({ index, issue: `${issue.path.join('.') || 'root'} — ${issue.message}` });
  });

  return { kept, dropped };
}
