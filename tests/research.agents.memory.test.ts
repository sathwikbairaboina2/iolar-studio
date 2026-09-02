import { describe, it, expect, vi } from 'vitest';
import { parseBrief } from '@/lib/reel/research/brief';

const brief = () =>
  parseBrief({
    runId: 'r',
    createdAt: '2026-09-02T00:00:00.000Z',
    topic: 'SQLite',
    angle: 'a',
    audience: 'b',
    videoFormat: 'reel',
    mustProve: ['one', 'two'],
    mustInclude: [],
    avoid: [],
    recencyWindowDays: 30,
    sourceClasses: ['docs'],
    searchQueries: [{ class: 'docs', queries: ['q'] }],
    referenceReel: null,
    status: 'briefed',
  });

const runner = (reply: string) => {
  const prompts: string[] = [];
  const run = vi.fn(async (prompt: string) => {
    prompts.push(prompt);
    return reply;
  });
  return { run, prompts };
};

describe('memory in the prompts', () => {
  it('the planner reads the domain block before the shape contract, and nothing when it is empty', async () => {
    const { planSearch } = await import('@/lib/reel/research/agents');
    const plan = JSON.stringify({ approach: 'x', queries: [{ class: 'docs', query: 'q', proves: 'one', why: 'w' }] });
    const a = runner(plan);
    await planSearch(brief(), a.run, 'What worked before for topics like these:\n  sqlite.org kept 5, rejected 0');
    expect(a.prompts[0]).toContain('MEMORY\nWhat worked before for topics like these:');
    expect(a.prompts[0].indexOf('MEMORY')).toBeLessThan(a.prompts[0].indexOf('Reply with ONLY'));
    const b = runner(plan);
    await planSearch(brief(), b.run, '');
    expect(b.prompts[0]).not.toContain('MEMORY');
  });

  it('the critic reads prior verdicts', async () => {
    const { critique } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ candidates: [] }));
    await critique(brief(), [{ url: 'https://x' }], a.run, 'Seen before:\n  https://x: rejected on 2026-09-01 in r (dup)');
    expect(a.prompts[0]).toContain('MEMORY\nSeen before:');
    expect(a.prompts[0].indexOf('MEMORY')).toBeLessThan(a.prompts[0].indexOf('Reply with ONLY'));
  });

  it('the writer reads proven claims', async () => {
    const { draftScript } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ lines: [] }));
    await draftScript(brief(), [], {}, a.run, undefined, 'Already proven, with the passage that proved it:\n- "one" — citable: https://x');
    expect(a.prompts[0]).toContain('MEMORY\nAlready proven');
    expect(a.prompts[0].indexOf('MEMORY')).toBeLessThan(a.prompts[0].indexOf('Reply with ONLY'));
  });

  it('the verifier gets passages per line, ahead of the keyword windows', async () => {
    const { verifyScript } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ flags: [] }));
    const lines = [
      { id: 'l1', order: 0, role: 'body', text: 'The suite is 590 times larger.', citations: ['c1'], assetIds: [], note: null, commentary: false },
    ] as never;
    const cands = [{ id: 'c1', url: 'https://x', canonicalUrl: 'https://x', title: 't', summary: 's' }] as never;
    const evidence = { c1: { text: 'intro. The suite is 590 times larger than the library. outro.' } };
    await verifyScript(lines, cands, evidence, a.run, (l) =>
      l.id === 'l1' ? 'Nearest passages in the cited sources:\n  [https://x] The suite is 590 times larger than the library.' : ''
    );
    const p = a.prompts[0];
    expect(p).toContain('Nearest passages in the cited sources:');
    expect(p.indexOf('Nearest passages')).toBeLessThan(p.indexOf('[c1] t'));
  });
});
