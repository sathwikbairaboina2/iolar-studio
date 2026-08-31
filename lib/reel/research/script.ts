import { z } from 'zod';

/**
 * The workflow's deliverable: what the voice says, and what proves it.
 *
 * Two properties are load-bearing. Concatenating `lines[].text` in order yields
 * a plain script, which is the form a reel planner consumes — so the structure
 * costs nothing downstream. And every factual line carries the candidate ids
 * that support it, so the link between a claim and its source survives to the
 * end instead of being discarded at the last step.
 */

const candidateId = z.string().regex(/^[0-9a-f]{12}$/);

export const SCRIPT_ROLES = ["hook", "body", "close"] as const;

export const ScriptLineSchema = z
  .object({
    /** Stable across redrafts, so a hand edit survives the model rewriting around it. */
    id: z.string().min(1),
    order: z.number().int().min(0),
    role: z.enum(SCRIPT_ROLES),
    text: z.string().trim().min(1),
    /** What proves this line. */
    citations: z.array(candidateId),
    /** What should be on screen while it is said — often not the same source. */
    assetIds: z.array(candidateId),
    /** Why the line is here, or what a revision changed about it. */
    note: z.string().nullable(),
    /** An opinion rather than a claim, and so allowed to stand uncited. */
    commentary: z.boolean().default(false),
  })
  .strict();

export const ScriptSchema = z
  .object({
    runId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: z.enum(["draft", "revised", "approved"]),
    lines: z.array(ScriptLineSchema),
    /** brief.mustProve claims that no line covers. Reported, never silently dropped. */
    unsupported: z.array(z.string()),
    /**
     * What the coverage judge decided, per claim, and which lines carry it.
     *
     * Kept so an edit can be re-checked without asking the model again: drop the
     * only line proving a claim and it goes unsupported immediately. Defaulted,
     * because scripts written before the judge existed have none.
     */
    coverage: z
      .array(z.object({ claim: z.string(), lineIds: z.array(z.string()), why: z.string() }).strict())
      .default([]),
  })
  .strict()
  .superRefine((script, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const line of script.lines) {
      if (ids.has(line.id)) {
        ctx.addIssue({ code: "custom", path: ["lines", "id"], message: `duplicate line id "${line.id}"` });
      }
      if (orders.has(line.order)) {
        ctx.addIssue({ code: "custom", path: ["lines", "order"], message: `duplicate order ${line.order}` });
      }
      ids.add(line.id);
      orders.add(line.order);
    }
  });

export type ScriptLine = z.infer<typeof ScriptLineSchema>;
export type Script = z.infer<typeof ScriptSchema>;

export function parseScript(raw: unknown): Script {
  const result = ScriptSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`script.json: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return result.data;
}

/** The plain script, which is what a reel planner takes. */
export function plainScript(script: Script): string {
  return [...script.lines]
    .sort((a, b) => a.order - b.order)
    .map((l) => l.text.trim())
    .join("\n");
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "it", "its", "that", "this", "as", "at", "by", "from", "now", "get", "gets",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      // "computers" and "computer" are the same claim.
      .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w))
  );
}

/**
 * Which of the brief's claims the script never actually makes.
 *
 * Matching is deliberately loose — a script restates a claim in its own words —
 * but a commentary line proves nothing, because it is an opinion the research
 * never backed.
 */
/**
 * The fallback when the coverage judge cannot be reached.
 *
 * Keyword overlap against a per-line threshold, which is wrong whenever the
 * script proves a claim in its own words or across two lines — see
 * `judgeCoverage`, which is what normally decides this. Kept because a script
 * must still be written when Claude is unavailable, and a crude warning beats
 * silently claiming everything is proved.
 */
export function unsupportedClaims(mustProve: string[], lines: ScriptLine[]): string[] {
  const factual = lines.filter((l) => !l.commentary && l.citations.length > 0);
  return mustProve.filter((claim) => {
    const wanted = keywords(claim);
    // Nothing matchable in the claim, so nothing can show it was made. Report it
    // rather than pass it: an unverifiable claim is the user's to look at.
    if (wanted.size === 0) return true;
    return !factual.some((line) => {
      const said = keywords(line.text);
      const hits = [...wanted].filter((w) => said.has(w)).length;
      return hits / wanted.size >= 0.5;
    });
  });
}

/**
 * Folds a redraft onto the lines a human already edited.
 *
 * The user's wording wins, because they chose it; everything the model is better
 * placed to know — which sources back the line, what to show — is taken from the
 * redraft. A line the user deleted stays deleted rather than reappearing.
 */
export function mergeLineEdits(
  redrafted: ScriptLine[],
  edited: ScriptLine[],
  deletedIds: string[] = []
): ScriptLine[] {
  const byId = new Map(edited.map((l) => [l.id, l]));
  const dropped = new Set(deletedIds);
  return redrafted
    .filter((line) => !dropped.has(line.id))
    .map((line) => {
      const mine = byId.get(line.id);
      return mine ? { ...line, text: mine.text, note: mine.note ?? line.note } : line;
    });
}

/**
 * Re-derives which claims are unsupported from a judgement already made.
 *
 * The lines can change after the judge has run — the studio's edit path drops
 * them and marks them commentary — and the point of storing which lines carry a
 * claim is that those edits are answerable without another model call. A claim
 * survives while at least one line that stated it is still a cited factual line.
 */
export function unsupportedFromCoverage(
  mustProve: string[],
  coverage: { claim: string; lineIds: string[] }[],
  lines: ScriptLine[]
): string[] {
  const alive = new Set(lines.filter((l) => !l.commentary && l.citations.length > 0).map((l) => l.id));
  const byClaim = new Map(coverage.map((c) => [c.claim.trim(), c.lineIds]));
  return mustProve.filter((claim) => {
    const ids = byClaim.get(claim.trim());
    // No judgement for this claim at all — it was never shown to be covered.
    if (!ids) return true;
    return !ids.some((id) => alive.has(id));
  });
}
