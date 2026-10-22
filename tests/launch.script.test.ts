import type { Brief } from '@/lib/launch/schema';
import { describe, expect, it } from 'vitest';
import { generateLaunchScript, launchScriptPrompt } from '@/lib/launch/script';

const brief: Brief = { title: 'Gemini 4', links: ['https://blog.google/gemini-4'], mode: 'faceless', speed: 'fast', seconds: 45, creditBudget: 0, demos: [], posts: [], createdAt: '2026-10-21T00:00:00Z' };
const claim = { id: 'c1', text: 'Gemini 4 costs $3 per 1M input tokens', value: 3, unit: '$', url: 'https://ai.google.dev/pricing', quote: '$3.00 / 1M tokens' };

describe('launch script', () => {
  it('rejects a script over the word cap and asks again', async () => {
    const long = { headline: 'Gemini 4 is here', kicker: 'BREAKING', beats: ['hook', 'numbers', 'catch', 'cta'].map((id) => ({ id, narration: 'word '.repeat(60).trim(), claims: [] })) };
    const short = { ...long, beats: long.beats.map((b) => ({ ...b, narration: 'Short and true.' })) };
    const said = [JSON.stringify(long), JSON.stringify(short)];
    const prompts: string[] = [];
    const s = await generateLaunchScript(brief, { claims: [claim] }, { run: async (p) => { prompts.push(p); return said.shift()!; } });
    expect(s.beats[0].narration).toBe('Short and true.');
    expect(prompts[1]).toMatch(/words/);
  });
  it('with a reference, caps the hook by its length and says not to copy it', () => {
    const ref = { id: 'AAAAA1', creator: 'varunmayya', url: 'https://instagram.com/reel/AAAAA1', topic: 'Gemini 4 launch', hookSec: 2.5, medianShotSec: 3 };
    const p = launchScriptPrompt({ ...brief, reference: ref }, { claims: [claim] });
    expect(p).toMatch(/hook: at most 7 words/);
    expect(p).toMatch(/3 seconds/);
    expect(p).toMatch(/do not copy/i);
    expect(launchScriptPrompt({ ...brief, reference: { ...ref, hookSec: 0.5 } }, { claims: [claim] })).toMatch(/at most 6 words/);
    expect(launchScriptPrompt(brief, { claims: [claim] })).toMatch(/14 words or fewer/);
    expect(launchScriptPrompt(brief, { claims: [claim] })).not.toMatch(/do not copy/i);
  });
  it('writes in a Gen Z Indian creator persona with a Hinglish cap', () => {
    const p = launchScriptPrompt(brief, { claims: [claim] });
    expect(p).toMatch(/22-year-old Indian tech creator/);
    expect(p).toMatch(/at most one Hinglish word or phrase per beat and at most three in the whole reel/);
    expect(p).toMatch(/Never put Hinglish inside a number, a product name or a claim/);
    expect(p).toMatch(/at most one per reel/);
    expect(p).toMatch(/Bro, Google just made GPT-6 look expensive/);
    expect(p).toContain('Follow, I break down every AI launch in under a minute.');
    expect(p).toMatch(/"insane"/);
  });
  it('lists every claim id with its quote in the prompt', () => {
    expect(launchScriptPrompt(brief, { claims: [claim] })).toContain('c1');
  });
});
