import { z } from 'zod';
import { runClaude } from '@/lib/ai/claude';
import type { Brief } from './brief';
import { CandidateSchema, type Candidate } from './candidate';
import type { Evidence } from './gather';
import type { ScriptLine } from './script';
import { parsePlan, type SearchPlan } from './plan';

/**
 * The three stages Claude runs, driven through the same headless CLI that
 * already writes the beats.
 *
 * Verified before building on it: `claude -p --allowedTools Task,WebSearch`
 * dispatches concurrent subagents and searches the web, returning clean JSON.
 * That is what makes the research a server route rather than a separate app.
 *
 * Each stage gets only the tools it needs. The hunt searches; the critic and
 * the script stage judge what was already found and must not go looking for
 * more, or the pack the user reviewed stops being the pack the script cites.
 */

export type Runner = (
  prompt: string,
  opts?: { timeoutMs?: number; allowedTools?: string[]; onTool?: (call: { name: string; input: Record<string, unknown> }) => void }
) => Promise<string>;

const HUNT_TIMEOUT_MS = 900_000;
/**
 * Judging is its own long stage: the critic reads every source the hunt found,
 * and a wide brief finds thirty. At 300s a pack of twenty-seven timed out with
 * the hunt already paid for.
 */
const CRITIC_TIMEOUT_MS = 600_000;
const STAGE_TIMEOUT_MS = 300_000;

/**
 * Pulls the JSON out of a reply.
 *
 * A model asked for JSON usually gives JSON, sometimes fenced, occasionally
 * wrapped in a sentence. What it must never do is half-parse: a truncated reply
 * fails loudly, because a partial candidate list looks exactly like a thin one.
 */
export function extractJson<T = unknown>(raw: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidates = [fenced?.[1], raw].filter(Boolean) as string[];

  for (const text of candidates) {
    // Take the shape the reply actually is, decided by whichever bracket opens
    // first. Trying both shapes in turn is how a truncated array gets salvaged
    // as its first object — a half-parse that reads as a short list rather than
    // a failure — and how {"lines":[...]} gets read as the inner array.
    const arrayAt = text.indexOf('[');
    const objectAt = text.indexOf('{');
    if (arrayAt < 0 && objectAt < 0) continue;
    const isArray = arrayAt >= 0 && (objectAt < 0 || arrayAt < objectAt);

    const start = isArray ? arrayAt : objectAt;
    const end = text.lastIndexOf(isArray ? ']' : '}');
    if (end <= start) continue;

    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      // Not parseable; fall through to the unfenced text, then fail loudly.
    }
  }
  throw new Error(`could not read JSON from the model's reply: ${raw.slice(0, 200)}`);
}

function briefBlock(brief: Brief): string {
  return [
    `Topic: ${brief.topic}`,
    `Angle: ${brief.angle}`,
    `Audience: ${brief.audience}`,
    `Format: ${brief.videoFormat}`,
    `Must prove:\n${brief.mustProve.map((c) => `  - ${c}`).join('\n')}`,
    brief.mustInclude.length ? `Must include: ${brief.mustInclude.join(', ')}` : '',
    brief.avoid.length ? `Avoid: ${brief.avoid.join(', ')}` : '',
    `Nothing older than ${brief.recencyWindowDays} days unless it is foundational.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Stage 1½ — the strategy, before any search runs.
 *
 * No tools: this is thinking, not looking. The reply is the plan a person will read and
 * edit, so it asks for concrete queries — the kind you could paste into a search box —
 * each pinned to one of the brief's claims, each with the reason it should work.
 */
export async function planSearch(brief: Brief, run: Runner = runClaude): Promise<SearchPlan> {
  const prompt = `You are planning the research for a short video. Do not search yet — write the plan.

${briefBlock(brief)}

Source classes available: ${brief.sourceClasses.join(', ')}.

Write 2-4 concrete search queries per source class the brief allows — the exact strings a
person would type — each aimed at ONE of the must-prove claims above, quoted verbatim in
"proves". Prefer queries that would land on primary sources (the paper, the filing, the
changelog, the talk) over coverage of them. Vary the queries: names, numbers, dates and
document types beat restating the angle.

Reply with ONLY:
{ "approach": "<two or three sentences: what to look for first, what to distrust>",
  "queries": [ { "class": "<one of the classes>", "query": "...", "proves": "<a must-prove claim, verbatim>", "why": "<one sentence>" } ] }

No prose, no fence.`;

  const out = extractJson<{ approach: string; queries: unknown[] }>(
    await run(prompt, { timeoutMs: STAGE_TIMEOUT_MS })
  );
  return parsePlan({
    runId: brief.runId,
    generatedAt: new Date().toISOString(),
    approach: out.approach,
    queries: out.queries,
  });
}

/** Stage 2 — one subagent per source class, dispatched together. */
export async function huntSources(
  brief: Brief,
  run: Runner = runClaude,
  onTool?: Parameters<Runner>[1] extends { onTool?: infer T } | undefined ? T : never
): Promise<Record<string, unknown>[]> {
  const perClass = brief.searchQueries
    .map((q) => `### ${q.class}\n${q.queries.map((s) => `  - ${s}`).join('\n')}`)
    .join('\n\n');

  const prompt = `You are hunting source material for a short video.

${briefBlock(brief)}

Dispatch ONE Task subagent per source class below, all in a single message so they run
concurrently. Give each subagent the brief above, its own class name, and only its own queries.

${perClass}

Each subagent uses WebSearch and WebFetch and returns a JSON array. One object per source:

{ "class": "<its class>", "url": "...", "title": "...", "publisher": "...", "author": null,
  "publishedAt": "<ISO or null>", "summary": "<= 280 chars, what it actually says",
  "pullQuotes": [{ "text": "...", "context": "..." }],
  "stats": [{ "value": "...", "unit": "...", "claim": "..." }],
  "assetKind": "broll|screenshot|quote|data|repo|doc",
  "whyItMatters": "which must-prove claim this supports, and how" }

Prefer primary sources over coverage of them. Do not invent a URL you did not open.

Reply with ONLY the concatenated JSON array of every subagent's results. No prose, no fence.`;

  return extractJson<Record<string, unknown>[]>(
    await run(prompt, { timeoutMs: HUNT_TIMEOUT_MS, allowedTools: ['Task', 'WebSearch', 'WebFetch'], onTool })
  );
}

/** Stage 3 — score, dedupe and reject, judging only what the hunt found. */
export async function critique(
  brief: Brief,
  raw: Record<string, unknown>[],
  run: Runner = runClaude
): Promise<{ candidates: Candidate[] }> {
  const prompt = `You are the adversarial critic on a video research pack. Be hard to please.

${briefBlock(brief)}

Judge these candidates. Do not search for more — your job is to sort what was found.

${JSON.stringify(raw, null, 1)}

For each: score it, and set a verdict of keep, maybe or reject with a reason. Collapse
duplicates by setting dupeOf to the id of the one you kept. Ids are rewritten from the URL
after you reply, so any stable placeholder will do — dupeOf is remapped with them. Reject anything
that is SEO filler, is outside the recency window without being foundational, cannot be
verified, or leans on the framing the brief said to avoid.

Reply with ONLY:

{ "candidates": [ <each one matching this schema exactly> ] }

${JSON.stringify(z.toJSONSchema(CandidateSchema), null, 1)}

Every field is required. No prose, no fence.`;

  return extractJson<{ candidates: Candidate[] }>(await run(prompt, { timeoutMs: CRITIC_TIMEOUT_MS }));
}

/** Stage 6 — narration, cited line by line, from the pack the user kept. */
export async function draftScript(
  brief: Brief,
  candidates: Candidate[],
  evidence: Record<string, Pick<Evidence, 'text'>>,
  run: Runner = runClaude
): Promise<ScriptLine[]> {
  const sources = candidates
    .map((c) => {
      const gathered = evidence[c.id]?.text;
      return [
        `## ${c.id} — ${c.title} (${c.publisher})`,
        c.summary ? `summary: ${c.summary}` : '',
        c.stats?.length ? `stats: ${c.stats.map((s) => `${s.value}${s.unit} — ${s.claim}`).join('; ')}` : '',
        // The gathered evidence is what the source actually said; the summary is
        // the critic's compression of it and can drift.
        gathered ? `evidence (what the source actually says):\n${gathered.slice(0, 4000)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const prompt = `Write the narration for a short video, from these sources only.

${briefBlock(brief)}

# Sources you may cite

${sources}

# Rules

- Every factual line carries a citation: the id of a source above that supports it. If nothing
  above supports a sentence, either cut it or set "commentary": true and own it as opinion.
- Prefer the evidence over the summary where both are present.
- "citations" is what proves the line. "assetIds" is what should be on screen while it is said.
  They are frequently different.
- Honour the avoid list. Work the must-include names in naturally or leave them out.
- A reel is roughly 120-160 spoken words. Earn the first two seconds; land the angle at the end.

# Craft — what separates this from narrated slides

- The hook is a specific, checkable surprise: a number, a contradiction, a deadline, a cost.
  Never "in this video", never a question the viewer can answer with "no".
- Open one loop in the hook or first body line — something named but not yet explained — and
  pay it off before the close. The payoff line should be the strongest fact you have.
- One idea per sentence. Spoken sentences run short — twelve words is long. Concrete numbers
  beat adjectives; "35 million euros" beats "massive fines".
- Every line is one or two COMPLETE sentences. Never end a line mid-sentence; the line is the
  unit the video is cut on.
- The close is an implication or a sting, not a summary. Banned: "so there you have it",
  "at the end of the day", any ask to like, follow or subscribe.

Reply with ONLY:
{ "lines": [ { "id": "l1", "order": 0, "role": "hook|body|close", "text": "...",
               "citations": ["<id>"], "assetIds": ["<id>"], "note": null, "commentary": false } ] }

No prose, no fence.`;

  const out = await run(prompt, { timeoutMs: STAGE_TIMEOUT_MS });
  return extractJson<{ lines: ScriptLine[] }>(out).lines ?? [];
}

export type Coverage = { claim: string; lineIds: string[]; why: string };

/**
 * Which of the brief's must-prove claims the script actually makes.
 *
 * This was keyword overlap, and it was wrong far more often than it was right:
 * three consecutive live runs flagged every claim while the script stated each
 * one outright. The words a brief uses to *ask* for evidence are not the words
 * a script uses to *give* it — "the maximum fine as a figure and a percentage
 * of turnover" against "Article 99 sets the ceiling: thirty-five million euros,
 * or seven percent of total worldwide annual turnover" shares almost nothing,
 * and a claim proved across two lines could never match a per-line threshold.
 *
 * So the reading is done by the model that can read. It answers only about what
 * the lines say — not what the sources behind them say — because the question
 * is whether this script makes the claim, and a line that contradicts a claim
 * must not be counted as proving it.
 */
export async function judgeCoverage(
  mustProve: string[],
  lines: ScriptLine[],
  run: Runner = runClaude
): Promise<Coverage[]> {
  const factual = lines.filter((l) => !l.commentary && l.citations.length > 0);
  if (mustProve.length === 0) return [];
  if (factual.length === 0) {
    return mustProve.map((claim) => ({ claim, lineIds: [], why: 'the script has no cited factual lines' }));
  }

  const prompt = `You are checking whether a short video script makes the claims its brief required.

The brief said the sources must prove:
${mustProve.map((c, i) => `${i + 1}. ${c}`).join('\n')}

These are the script's factual lines:
${factual.map((l) => `[${l.id}] ${l.text}`).join('\n')}

For each required claim, decide whether these lines state it. Judge only what the lines
say — not what their sources might say elsewhere. Rules:

- Different wording still counts. "Article 99 sets the ceiling: thirty-five million euros,
  or seven percent of turnover" states "the maximum fine, as a figure and a percentage".
- Several lines together count. List every line that carries part of it.
- A line that contradicts the claim does NOT cover it. If the script says a thing did not
  happen, a claim that it happened is uncovered, however much vocabulary they share.
- A claim asking for a specific artefact — a name, a date, a version, a number, a quote —
  is only covered if that specific thing is actually in the lines.

Reply with ONLY:

{ "coverage": [ { "claim": "<the claim, copied exactly>",
                  "lineIds": [ "<ids of the lines that state it, empty if none>" ],
                  "why": "<one short sentence>" } ] }

One entry per claim, in the order given. No prose, no fence.`;

  const raw = await run(prompt, { timeoutMs: STAGE_TIMEOUT_MS });
  const parsed = extractJson<{ coverage?: Coverage[] }>(raw);
  const byClaim = new Map((parsed.coverage ?? []).map((c) => [String(c.claim).trim(), c]));
  const known = new Set(factual.map((l) => l.id));

  // The brief's claims are the answer's shape, not the model's: a claim it
  // forgot to mention is uncovered, and an id it invented is not a citation.
  return mustProve.map((claim) => {
    const got = byClaim.get(claim.trim());
    const lineIds = (got?.lineIds ?? []).map(String).filter((id) => known.has(id));
    return { claim, lineIds, why: got?.why ? String(got.why) : 'the judge did not answer for this claim' };
  });
}
