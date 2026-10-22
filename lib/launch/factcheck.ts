import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { FactCheckSchema, type Claims, type FactCheck, type Script } from './schema';

export const FACT_TOOLS = ['WebSearch', 'WebFetch'];

export function launchFactPrompt(script: Script, claims: Claims): string {
  return [
    'You fact-check the voiceover of a short news reel about a tech launch. Use WebFetch on the sources below, and WebSearch where they are not enough.',
    'Check every number, product name, date, availability statement and comparison in the headline and the narration.',
    'A claim is an issue if it is wrong, overstated, missing a condition it needs, or not supported by its source. Do not flag style.',
    '',
    `Headline: ${script.headline}`,
    'Beats:',
    ...script.beats.map((b) => `${b.id}: ${b.narration}  [cites ${b.claims.join(', ') || 'nothing'}]`),
    '',
    'Sources (claim id, what it says, url, the exact quote):',
    ...claims.claims.map((c) => `- ${c.id}: ${c.text} | ${c.url} | "${c.quote}"`),
    '',
    'Return ONLY JSON, no prose, no fences:',
    '{ "ok": boolean, "issues": [ { "beat": beat id or "headline", "claim": the exact words, "correction": what is true instead, in one sentence } ] }',
    'ok is true only when issues is empty.',
  ].join('\n');
}

export async function checkLaunchScript(script: Script, claims: Claims, deps: { run: ClaudeRun }): Promise<FactCheck> {
  const said = await deps.run(launchFactPrompt(script, claims), { model: 'opus', allowedTools: FACT_TOOLS, timeoutMs: 600_000 });
  const parsed = FactCheckSchema.parse(extractJson(said));
  return { ok: parsed.ok && parsed.issues.length === 0, issues: parsed.issues };
}
