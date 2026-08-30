import { runClaude } from '@/lib/ai/claude';
import type { Brief } from './brief';
import type { Candidate } from './candidate';
import type { Evidence } from './gather';
import type { ScriptLine } from './script';

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

export type Runner = (prompt: string, opts?: { timeoutMs?: number; allowedTools?: string[] }) => Promise<string>;

const HUNT_TIMEOUT_MS = 600_000;
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

/** Stage 2 — one subagent per source class, dispatched together. */
export async function huntSources(
  brief: Brief,
  run: Runner = runClaude
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
    await run(prompt, { timeoutMs: HUNT_TIMEOUT_MS, allowedTools: ['Task', 'WebSearch', 'WebFetch'] })
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

For each: give it a stable 12-hex-character id, score it, and set a verdict of keep, maybe or
reject with a reason. Collapse duplicates by setting dupeOf to the id you kept. Reject anything
that is SEO filler, is outside the recency window without being foundational, cannot be
verified, or leans on the framing the brief said to avoid.

Reply with ONLY:
{ "runId": "${brief.runId}", "generatedAt": "<ISO now>", "criticVersion": "1",
  "stats": { "perClass": {}, "totalFound": <n>, "totalKept": <n>, "dupesCollapsed": <n> },
  "candidates": [ ... ] }

No prose, no fence.`;

  return extractJson<{ candidates: Candidate[] }>(await run(prompt, { timeoutMs: STAGE_TIMEOUT_MS }));
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

Reply with ONLY:
{ "lines": [ { "id": "l1", "order": 0, "role": "hook|body|close", "text": "...",
               "citations": ["<id>"], "assetIds": ["<id>"], "note": null, "commentary": false } ] }

No prose, no fence.`;

  const out = await run(prompt, { timeoutMs: STAGE_TIMEOUT_MS });
  return extractJson<{ lines: ScriptLine[] }>(out).lines ?? [];
}
