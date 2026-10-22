import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { scriptSchemaFor, type Brief, type Claims, type Script } from './schema';

export const WORDS_PER_SECOND_NEWS = 2.7;
export const maxNewsWords = (seconds: number): number => Math.floor(seconds * WORDS_PER_SECOND_NEWS * 1.1);

export class LaunchScriptError extends Error {
  constructor(message: string, readonly said: string) {
    super(message);
    this.name = 'LaunchScriptError';
  }
}

const SHAPE = `{
  "headline": string (at most 48 characters, the front-page headline, e.g. "Gemini 4 is here."),
  "kicker": string (at most 24 characters, e.g. "BREAKING", "JUST SHIPPED"),
  "beats": [ { "id": "hook" | "what" | "numbers" | "demo" | "who" | "catch" | "cta", "narration": string, "emphasis": [string], "claims": ["c1"] } ]
}`;

const hookWords = (hookSec: number) => Math.max(6, Math.round(hookSec * WORDS_PER_SECOND_NEWS));

export function launchScriptPrompt(brief: Brief, claims: Claims, opts: { notes?: string; previous?: Script } = {}): string {
  const lines = [
    'You write the voiceover for a short vertical reel about a tech launch, in the voice of a 22-year-old Indian tech creator talking to camera to friends:',
    'fast, casual, warm, a little cheeky, second person, short sentences, concrete numbers, no hype words ("insane", "game-changer", "mind-blowing").',
    'Light Hinglish where it lands naturally: at most one Hinglish word or phrase per beat and at most three in the whole reel (e.g. "bro", "yaar", "matlab", "scene kya hai", "full paisa vasool").',
    'Never put Hinglish inside a number, a product name or a claim. Gen Z words only if they fit, at most one per reel ("lowkey", "no cap"); never stack slang.',
    '',
    `Launch: ${brief.title}`,
    `Length: ${brief.seconds} seconds. The narration of all beats together is at most ${maxNewsWords(brief.seconds)} words.`,
    '',
    'Claims you may use (cite their ids; use no fact that is not here):',
    ...claims.claims.map((c) => `- ${c.id}: ${c.text}${c.value !== undefined ? ` [value ${c.value}${c.unit ? ` ${c.unit}` : ''}]` : ''}`),
    '',
    'Return ONLY a JSON object of this shape, with no prose and no markdown fences:',
    SHAPE,
    '',
    'Rules:',
    '- Beats follow this arc and order: hook, what, numbers, demo, who, catch, cta. hook, numbers, catch and cta are required; drop what, demo or who',
    '  only when the claims do not support them. demo is only for a launch with an official demo; leave it out otherwise.',
    brief.reference
      ? `- hook: at most ${hookWords(brief.reference.hookSec)} words, about ${Math.round(brief.reference.hookSec)} seconds of speech, the one change that matters, in your voice ("Bro, Google just made GPT-6 look expensive.").`
      : '- hook: 14 words or fewer, the one change that matters, in your voice ("Bro, Google just made GPT-6 look expensive.").',
    '- numbers: say the 1 to 3 numbers that matter, each from a claim with a value, compared with what it replaces or competes with.',
    '- catch: the honest limit (price tier, availability, rate limit, what it is worse at). Every reel has one.',
    '- cta: one line, e.g. "Follow, I break down every AI launch in under a minute."',
    '- "claims": the ids each beat relies on. Every number spoken must come from a cited claim.',
    '- "emphasis": 0 to 3 words or short phrases copied exactly from that beat\'s narration (the numbers with their unit, the product name).',
    '- Spell numbers the way they should be spoken ("three dollars", "one million tokens").',
    ...(brief.reference ? ['- Another channel made a reel on this launch; only its hook length is given above. Write your own words from the claims: do not copy or imitate its phrasing.'] : []),
  ];
  if (opts.previous) lines.push('', 'The current script, to be revised:', JSON.stringify(opts.previous, null, 2));
  if (opts.notes?.trim()) lines.push('', 'Revision notes (apply every one):', opts.notes.trim());
  return lines.join('\n');
}

const wordCount = (s: Script) => s.beats.reduce((n, b) => n + b.narration.split(/\s+/).filter(Boolean).length, 0);

export async function generateLaunchScript(
  brief: Brief, claims: Claims, deps: { run: ClaudeRun }, opts: { notes?: string; previous?: Script } = {},
): Promise<Script> {
  const base = launchScriptPrompt(brief, claims, opts);
  const schema = scriptSchemaFor(claims.claims.map((c) => c.id));
  let prompt = base;
  let said = '';
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    said = await deps.run(prompt, { model: 'opus', timeoutMs: 300_000 });
    try {
      const script = schema.parse(extractJson(said));
      const words = wordCount(script);
      const cap = maxNewsWords(brief.seconds);
      if (words > cap) throw new Error(`the narration is ${words} words; the cap for ${brief.seconds} seconds is ${cap} words`);
      return script;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      prompt = `${base}\n\nYour previous answer was rejected: ${error.slice(0, 600)}\nReturn the corrected JSON only.`;
    }
  }
  throw new LaunchScriptError(`the script did not validate: ${error.slice(0, 300)}`, said);
}
