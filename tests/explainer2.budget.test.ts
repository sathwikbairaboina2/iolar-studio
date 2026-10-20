import { describe, expect, it } from 'vitest';
import { HOOK_WORD_LIMIT, countWords, cutNotes, maxWords, scriptSchemaFor, scriptWords, trimDecision, wordBudget } from '@/lib/explainer2/budget';
import { scriptPrompt } from '@/lib/explainer2/script';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const beat = (i: number, n: number) => ({ id: `b${i}`, caption: 'Caption', narration: words(n), visual: 'Something changes' });
const script = (counts: number[]) => ({
  title: 'T',
  hook: { before: { value: 9, unit: 'ms', label: 'a' }, after: { value: 1, unit: 'ms', label: 'b' } },
  beats: counts.map((n, i) => beat(i + 1, n)),
  facts: [],
});

describe('word budget', () => {
  it('is seconds x 2.5, and the schema allows 115% of it', () => {
    expect(wordBudget(30)).toBe(75);
    expect(wordBudget(45)).toBe(112);
    expect(maxWords(30)).toBe(86);
    expect(maxWords(20)).toBe(57);
  });
  it('counts words by whitespace', () => {
    expect(countWords('  one two\nthree  ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(scriptWords(script([10, 20, 5, 5]) as never)).toBe(40);
  });
});

describe('scriptSchemaFor', () => {
  it('accepts a script within 115% of the budget', () => {
    expect(scriptSchemaFor(30).safeParse(script([15, 20, 20, 20])).success).toBe(true); // 75
    expect(scriptSchemaFor(30).safeParse(script([16, 23, 23, 24])).success).toBe(true); // 86, the cap
  });
  it('rejects one over it, saying by how much', () => {
    const r = scriptSchemaFor(30).safeParse(script([16, 24, 24, 24])); // 88
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/88 words/);
    expect(JSON.stringify(r.error?.issues)).toMatch(/75/);
  });
  it('still applies the base script rules', () => expect(scriptSchemaFor(30).safeParse({ title: 'x' }).success).toBe(false));
});

describe('trimDecision', () => {
  it('leaves a video at or under seconds x 1.15 alone', () => {
    expect(trimDecision({ measuredSeconds: 34.5, seconds: 30, words: 80, rewrites: 0 }).trim).toBe(false);
    expect(trimDecision({ measuredSeconds: 28, seconds: 30, words: 70, rewrites: 0 }).trim).toBe(false);
  });
  it('asks for a cut when it runs over, to a count that brings it back to the target', () => {
    const d = trimDecision({ measuredSeconds: 38, seconds: 30, words: 100, rewrites: 0 });
    expect(d.trim).toBe(true);
    expect(d.targetWords).toBe(75); // min(budget 75, 100 x 30/38 = 78)
    const e = trimDecision({ measuredSeconds: 45, seconds: 30, words: 100, rewrites: 0 });
    expect(e.targetWords).toBe(66);
  });
  it('rewrites at most once', () => {
    expect(trimDecision({ measuredSeconds: 60, seconds: 30, words: 100, rewrites: 1 }).trim).toBe(false);
  });
  it('words the request', () => expect(cutNotes(70)).toMatch(/cut to 70 words/i));
});

describe('the script prompt', () => {
  const brief = { topic: 'Caching', audience: 'engineers', claim: 'Caches help', seconds: 30 };
  it('states the budget, the hook limit and the emphasis field', () => {
    const p = scriptPrompt(brief);
    expect(p).toContain('75 words');
    expect(p).toContain(`${HOOK_WORD_LIMIT} words or fewer`);
    expect(p).toContain('"emphasis"');
  });
});
