import { describe, expect, it, vi } from 'vitest';
import { generateScript, scriptPrompt, ScriptError } from '@/lib/explainer2/script';
import { checkFacts, factcheckPrompt, issuesToNotes } from '@/lib/explainer2/factcheck';
import type { Brief, Script } from '@/lib/explainer2/schema';

const BRIEF: Brief = { topic: 'Caching', audience: 'backend engineers', claim: 'A cache trades freshness for speed', seconds: 30 };
const beat = (i: number) => ({ id: `b${i}`, caption: `Caption ${i}`, narration: `Narration ${i} says something useful.`, visual: `Visual ${i}` });
const SCRIPT: Script = {
  title: 'Why caching feels instant',
  hook: { before: { value: 800, unit: 'ms', label: 'Without a cache' }, after: { value: 20, unit: 'ms', label: 'With a cache' } },
  beats: [1, 2, 3, 4].map(beat),
  facts: ['Redis reads are sub-millisecond.'],
};

describe('scriptPrompt', () => {
  it('carries the brief, the limits and the JSON-only rule', () => {
    const p = scriptPrompt(BRIEF);
    expect(p).toContain('Caching');
    expect(p).toContain('backend engineers');
    expect(p).toContain('A cache trades freshness for speed');
    expect(p).toContain('30');
    expect(p).toMatch(/40 char/);
    expect(p).toMatch(/80 char/);
    expect(p).toMatch(/220 char/);
    expect(p).toMatch(/4.{1,5}7 beats/);
    expect(p).toMatch(/only.*json/i);
  });
  it('quotes notes and the previous script when revising', () => {
    const p = scriptPrompt(BRIEF, { notes: 'Make the hook about p99', previous: SCRIPT });
    expect(p).toContain('Make the hook about p99');
    expect(p).toContain('Why caching feels instant');
  });
});

describe('generateScript', () => {
  it('parses fenced JSON from the model, on opus, with no tools', async () => {
    const run = vi.fn().mockResolvedValue('```json\n' + JSON.stringify(SCRIPT) + '\n```');
    const s = await generateScript(BRIEF, { run });
    expect(s.title).toBe('Why caching feels instant');
    const opts = run.mock.calls[0][1];
    expect(opts.model).toBe('opus');
    expect(opts.allowedTools).toBeUndefined();
  });
  it('asks once more with the validation error quoted, then gives up', async () => {
    const bad = { ...SCRIPT, title: 'x'.repeat(60) };
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify(SCRIPT));
    const s = await generateScript(BRIEF, { run });
    expect(s.title).toBe('Why caching feels instant');
    expect(run.mock.calls[1][0]).toContain('title');
    const fail = vi.fn().mockResolvedValue('not json at all');
    await expect(generateScript(BRIEF, { run: fail })).rejects.toBeInstanceOf(ScriptError);
    expect(fail).toHaveBeenCalledTimes(2);
  });
});

describe('fact check', () => {
  it('lists the facts and every number to check, and allows only the web tools', async () => {
    const p = factcheckPrompt(SCRIPT);
    expect(p).toContain('Redis reads are sub-millisecond.');
    expect(p).toContain('800');
    expect(p).toContain('Narration 2');
    const run = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, issues: [] }));
    const r = await checkFacts(SCRIPT, { run });
    expect(r).toEqual({ ok: true, issues: [] });
    const opts = run.mock.calls[0][1];
    expect(opts.allowedTools).toEqual(['WebSearch', 'WebFetch']);
    expect(opts.model).toBe('opus');
  });
  it('returns the issues, and treats ok with issues as not ok', async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, issues: [{ beat: 'b2', claim: '99% hit rate', correction: 'Typical is 80-95%' }] }));
    const r = await checkFacts(SCRIPT, { run });
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
  });
  it('turns issues into notes for a rewrite', () => {
    const n = issuesToNotes([{ beat: 'b2', claim: '99% hit rate', correction: 'Typical is 80-95%' }]);
    expect(n).toContain('b2');
    expect(n).toContain('99% hit rate');
    expect(n).toContain('Typical is 80-95%');
  });
});
