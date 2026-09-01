import { z } from 'zod';
import { SourceClassSchema, type Brief } from './brief';

/**
 * The search strategy, written down before a single search runs.
 *
 * The brief used to go straight to the hunters with the angle pasted once per source
 * class as its "queries", and the hunters improvised the real searches out of sight. A
 * pack of sources with no visible strategy behind it is not something to trust: whether
 * it looked in the right places, for the right claims, was unknowable until the script
 * came out wrong.
 *
 * So the strategy is now a stage of its own, with a gate. Each line is one concrete query,
 * the claim it is meant to prove, and why that query in that place should find it. A person
 * reads it, edits it, and only then does the hunt run — with exactly these queries.
 */
export const PlannedQuerySchema = z
  .object({
    class: SourceClassSchema,
    query: z.string().trim().min(1),
    /** Which must-prove claim this query is hunting for, verbatim from the brief. */
    proves: z.string().trim().min(1),
    /** Why this query, in this class, should find it. One sentence. */
    why: z.string().trim().min(1),
  })
  .strict();

export const SearchPlanSchema = z
  .object({
    runId: z.string().min(1),
    generatedAt: z.string().datetime(),
    /** The overall approach in two or three sentences: what to look for first, what to distrust. */
    approach: z.string().trim().min(1),
    queries: z.array(PlannedQuerySchema).min(1),
  })
  .strict();

export type PlannedQuery = z.infer<typeof PlannedQuerySchema>;
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

export function parsePlan(raw: unknown): SearchPlan {
  const parsed = SearchPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`plan.json: ${issue.path.join('.') || 'root'} — ${issue.message}`);
  }
  return parsed.data;
}

/**
 * The plan folded back into the brief's per-class query lists, so the hunt — which reads
 * the brief — runs the approved queries and nothing else. Classes the plan never named
 * are dropped: an approved plan is the whole strategy, not a suggestion on top of one.
 */
export function briefWithPlan(brief: Brief, plan: SearchPlan): Brief {
  const byClass = new Map<Brief['sourceClasses'][number], string[]>();
  for (const q of plan.queries) {
    const list = byClass.get(q.class) ?? [];
    if (!list.includes(q.query)) list.push(q.query);
    byClass.set(q.class, list);
  }
  const searchQueries = [...byClass.entries()].map(([cls, queries]) => ({ class: cls, queries }));
  return { ...brief, sourceClasses: [...byClass.keys()], searchQueries };
}
