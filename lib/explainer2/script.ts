import { extractJson } from '@/lib/ai/revise';
import type { RunClaudeOpts } from '@/lib/ai/claude';
import { HOOK_WORD_LIMIT, scriptSchemaFor, wordBudget } from './budget';
import type { Brief, Script } from './schema';

/** The model runner, as `runClaude` has it; tests hand in a fake. */
export type ClaudeRun = (prompt: string, opts?: RunClaudeOpts) => Promise<string>;
export type ScriptDeps = { run: ClaudeRun };

export class ScriptError extends Error {
  constructor(message: string, readonly said: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

const SHAPE = `{
  "title": string (at most 40 characters),
  "hook": {
    "before": { "value": number, "unit": string (at most 12 chars, e.g. "ms", "%", "x"), "label": string (at most 40) },
    "after":  { "value": number, "unit": string, "label": string }
  },
  "beats": [ { "id": "b1", "caption": string, "narration": string, "visual": string, "emphasis": [ string ] } ],
  "facts": [ string ]
}`;

/** The writing prompt: a brief in, one JSON document out. No tools, so nothing here can be looked up; the fact check does that. */
export function scriptPrompt(brief: Brief, opts: { notes?: string; previous?: Script } = {}): string {
  const lines = [
    'You write the script for a short vertical explainer video about a software engineering topic.',
    'It is narrated aloud, captioned, and drawn as animated cards and packets on a dark violet board.',
    '',
    `Topic: ${brief.topic}`,
    `Audience: ${brief.audience}`,
    `The one claim the viewer must take away: ${brief.claim}`,
    `Target length: ${brief.seconds} seconds. Word budget: the narration of all beats together is at most ${wordBudget(brief.seconds)} words (${brief.seconds} seconds x 2.5 words a second). Count them; a script over the budget is rejected.`,
    '',
    'Return ONLY a JSON object of this shape, with no prose and no markdown fences:',
    SHAPE,
    '',
    'Rules:',
    '- "hook" is the cost delta shown first: one measurable before and one after for the topic (latency, load, cost, error rate). The numbers must be realistic for the topic, not invented to look dramatic.',
    `- 4 to 7 beats, ids "b1", "b2", ... in order. b1 is the hook beat: its narration states the before and after in plain words, in ${HOOK_WORD_LIMIT} words or fewer (it is the opener, about 4 seconds spoken).`,
    '- "caption": at most 80 characters, plain words, shown on screen for that beat.',
    '- "narration": at most 220 characters, spoken aloud. Short sentences. No emoji, no markdown, no abbreviations a voice would stumble on.',
    '- "visual": ONE sentence describing what changes on screen in that beat (a card appears, a packet travels, a number counts, a bar grows).',
    '- "emphasis": 0 to 4 words or short phrases copied exactly from the narration of that beat, which the captions highlight: the numbers (with their unit, e.g. "30 ms") and the key terms. Leave it empty when nothing stands out.',
    '- "facts": the specific claims and numbers the narration relies on, one per entry, each stated so it can be checked.',
    '- Explain one idea per beat; the last beat lands the claim. No jokes, no hype.',
  ];
  if (opts.previous) lines.push('', 'The current script, to be revised:', JSON.stringify(opts.previous, null, 2));
  if (opts.notes?.trim()) lines.push('', 'Revision notes (apply every one):', opts.notes.trim());
  return lines.join('\n');
}

/** Writes the script on Opus. A reply that fails validation is asked about once more with its own error quoted. */
export async function generateScript(brief: Brief, deps: ScriptDeps, opts: { notes?: string; previous?: Script } = {}): Promise<Script> {
  const base = scriptPrompt(brief, opts);
  let prompt = base;
  let lastSaid = '';
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    lastSaid = await deps.run(prompt, { model: 'opus', timeoutMs: 300_000 });
    try {
      return scriptSchemaFor(brief.seconds).parse(extractJson(lastSaid));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      prompt = `${base}\n\nYour previous answer was rejected: ${lastError.slice(0, 600)}\nReturn the corrected JSON only.`;
    }
  }
  throw new ScriptError(`the script did not validate: ${lastError.slice(0, 300)}`, lastSaid);
}
