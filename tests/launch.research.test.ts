import type { Brief } from '@/lib/launch/schema';
import { describe, expect, it } from 'vitest';
import { generateClaims, researchPrompt } from '@/lib/launch/research';

const brief: Brief = { title: 'Gemini 4', links: ['https://blog.google/gemini-4'], mode: 'faceless', speed: 'fast', seconds: 45, creditBudget: 0, demos: [], posts: [], createdAt: '2026-10-21T00:00:00Z' };
const claim = { id: 'c1', text: 'Gemini 4 costs $3 per 1M input tokens', value: 3, unit: '$', url: 'https://ai.google.dev/pricing', quote: '$3.00 / 1M tokens' };

describe('research', () => {
  it('names every link and the exact-quote rule', () => {
    const p = researchPrompt(brief);
    expect(p).toContain('https://blog.google/gemini-4');
    expect(p).toMatch(/word for word/);
  });
  it('with no links, sends the model to the official announcement, model card and pricing page for the topic', () => {
    const ref = { id: 'AAAAA1', creator: 'varunmayya', url: 'https://instagram.com/reel/AAAAA1', topic: 'Gemini 4 launch', hookSec: 2.5, medianShotSec: 3 };
    // the reference's transcript is not part of the brief at all, so it cannot reach the prompt
    const p = researchPrompt({ ...brief, links: [], reference: { ...ref, transcript: 'SECRET WORDS' } as never });
    expect(p).toMatch(/WebSearch/);
    expect(p).toMatch(/official announcement/);
    expect(p).toMatch(/model card/);
    expect(p).toMatch(/pricing page/);
    expect(p).toContain('Gemini 4 launch');
    expect(p).not.toContain('SECRET WORDS');
    expect(p).not.toContain('Links:');
  });
  it('asks again with the error when the first answer does not validate', async () => {
    const said = ['{"claims": []}', JSON.stringify({ claims: [claim] })];
    const prompts: string[] = [];
    const out = await generateClaims(brief, { run: async (p) => { prompts.push(p); return said.shift()!; } });
    expect(out.claims[0].id).toBe('c1');
    expect(prompts[1]).toMatch(/rejected/);
  });
  it('runs with web tools only', async () => {
    let tools: string[] | undefined;
    await generateClaims(brief, { run: async (_p, o) => { tools = o?.allowedTools; return JSON.stringify({ claims: [claim] }); } });
    expect(tools).toEqual(['WebSearch', 'WebFetch']);
  });
});
