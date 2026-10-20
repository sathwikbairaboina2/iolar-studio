import { extractJson } from '@/lib/ai/revise';
import { FactCheckSchema, type FactCheck, type Script } from './schema';
import type { ClaudeRun } from './script';

export type FactDeps = { run: ClaudeRun };
export type FactIssue = FactCheck['issues'][number];

/** The only tools the checker gets: the web, nothing that can touch a file. */
export const FACT_TOOLS = ['WebSearch', 'WebFetch'];

export function factcheckPrompt(script: Script): string {
  const beats = script.beats.map((b) => `${b.id}\n  caption: ${b.caption}\n  narration: ${b.narration}`).join('\n');
  return [
    'You fact-check the script of a short engineering explainer video. Use WebSearch and WebFetch to verify.',
    '',
    'Check every entry in "facts" and EVERY number, unit, product name and cause-and-effect claim in the hook, captions and narration.',
    'A claim is an issue if it is wrong, overstated, missing the condition it needs, or cannot be supported by a reliable source.',
    'A typical value stated as typical is fine. Do not flag style.',
    '',
    `Title: ${script.title}`,
    `Hook: ${script.hook.before.label} ${script.hook.before.value}${script.hook.before.unit} -> ${script.hook.after.label} ${script.hook.after.value}${script.hook.after.unit}`,
    'Facts:',
    ...script.facts.map((f) => `- ${f}`),
    'Beats:',
    beats,
    '',
    'Return ONLY JSON, no prose, no fences:',
    '{ "ok": boolean, "issues": [ { "beat": beat id or "facts" or "hook", "claim": the exact claim, "correction": what is true instead, in one sentence } ] }',
    'ok is true only when issues is empty.',
  ].join('\n');
}

/** Runs the check on Opus with web tools. `ok` with issues listed counts as not ok. */
export async function checkFacts(script: Script, deps: FactDeps): Promise<FactCheck> {
  const said = await deps.run(factcheckPrompt(script), { model: 'opus', allowedTools: FACT_TOOLS, timeoutMs: 600_000 });
  const parsed = FactCheckSchema.parse(extractJson(said));
  return { ok: parsed.ok && parsed.issues.length === 0, issues: parsed.issues };
}

/** The checker's findings as revision notes for the script writer. */
export function issuesToNotes(issues: readonly FactIssue[]): string {
  return [
    'A fact check found these problems. Fix every one, keeping the rest of the script as it is:',
    ...issues.map((i) => `- ${i.beat}: "${i.claim}" is wrong or unsupported. ${i.correction}`),
  ].join('\n');
}
