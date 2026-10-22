import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { ClaimsSchema, type Brief, type Claims } from './schema';

export const RESEARCH_TOOLS = ['WebSearch', 'WebFetch'];

export class ResearchError extends Error {
  constructor(message: string, readonly said: string) {
    super(message);
    this.name = 'ResearchError';
  }
}

const SHAPE = `{ "claims": [ { "id": "c1", "text": string, "value": number (optional), "unit": string (optional, at most 12 chars), "url": string, "quote": string } ] }`;

export function researchPrompt(brief: Brief): string {
  return [
    ...(brief.links.length
      ? [
          'You research a product launch for a short news reel. Read every link below with WebFetch. If the links do not give the price, the',
          'availability or the benchmark numbers, find the company\'s own pricing, model card or benchmark page with WebSearch and read it.',
        ]
      : [
          'You research a product launch for a short news reel. No links were given: use WebSearch to find the official announcement, the model card',
          'and the pricing page of the company that made it, read them with WebFetch, and take every claim from those pages.',
          `The launch, as a channel described it: ${brief.reference?.topic ?? brief.title}. Check that it is real and recent before you go on.`,
        ]),
    '',
    `Launch: ${brief.title}`,
    ...(brief.links.length ? ['Links:', ...brief.links.map((l) => `- ${l}`)] : []),
    '',
    'Return ONLY a JSON object of this shape, with no prose and no markdown fences:',
    SHAPE,
    '',
    'Rules:',
    '- 8 to 20 claims, ids c1, c2, ... Cover: what launched and by whom, when and where it is available, the price, the 2 to 4 headline benchmark',
    '  numbers together with the competitor numbers from the same table, the limits and catches (rate limits, regions, waitlists, price tiers).',
    '- "quote" is the shortest phrase that proves the claim, ideally 3 to 15 words: it is set large on screen and highlighted on a phone-sized screenshot.',
    '- "quote" is copied word for word from the page at "url", 4 to 300 characters, exactly as it appears in the page text (it will be searched for',
    '  on that page and highlighted on a screenshot). Do not paraphrase it, do not join two sentences, do not add an ellipsis.',
    '- "value" and "unit" only when the claim is one number: a price ("$" for dollars), a score ("%"), a size ("tokens"), a speed ("ms", "tokens/s").',
    '  Two claims meant to be compared (old price and new price, our score and theirs) must use the same unit.',
    '- Prefer the company\'s own pages. A number found only in press coverage is left out.',
  ].join('\n');
}

export async function generateClaims(brief: Brief, deps: { run: ClaudeRun }): Promise<Claims> {
  const base = researchPrompt(brief);
  let prompt = base;
  let said = '';
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    said = await deps.run(prompt, { model: 'opus', allowedTools: RESEARCH_TOOLS, timeoutMs: 900_000 });
    try {
      return ClaimsSchema.parse(extractJson(said));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      prompt = `${base}\n\nYour previous answer was rejected: ${error.slice(0, 600)}\nReturn the corrected JSON only.`;
    }
  }
  throw new ResearchError(`the claims did not validate: ${error.slice(0, 300)}`, said);
}
