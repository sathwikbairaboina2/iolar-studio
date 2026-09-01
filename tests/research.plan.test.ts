import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The strategy stage and the record of what the researcher did. Both exist for one
 * reason: a pack of sources is not something to trust blind, so the searches are written
 * down before they run and logged as they happen.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-plan-'));
});

const BRIEF = {
  runId: 'grok',
  createdAt: '2026-08-30T21:40:00.000Z',
  topic: 'LTX-Video',
  angle: 'Open weights turn a lottery into a fixed cost',
  audience: 'developers',
  videoFormat: 'reel',
  mustProve: ['the weights are open', 'inference is unlimited'],
  mustInclude: [],
  avoid: ['hype'],
  recencyWindowDays: 90,
  sourceClasses: ['github', 'docs', 'news'],
  searchQueries: [{ class: 'github', queries: ['x'] }],
  referenceReel: null,
  status: 'briefed',
} as const;

const PLAN = {
  runId: 'grok',
  generatedAt: '2026-08-30T21:41:00.000Z',
  approach: 'repo first',
  queries: [{ class: 'github' as const, query: 'LTX LICENSE', proves: 'the weights are open', why: 'w' }],
};

describe('reading claude stream-json', () => {
  it('lifts tool calls out of assistant turns and the answer out of the result line', async () => {
    const { parseStreamLine } = await import('@/lib/ai/claude');
    const turn = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'looking' },
          { type: 'tool_use', name: 'WebSearch', input: { query: 'ltx video license' } },
        ],
      },
    });
    expect(parseStreamLine(turn).tools).toEqual([{ name: 'WebSearch', input: { query: 'ltx video license' } }]);
    expect(parseStreamLine(JSON.stringify({ type: 'result', result: '[{"url":"x"}]' })).result).toBe('[{"url":"x"}]');
    expect(parseStreamLine('not json at all').tools).toEqual([]);
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'hook_started' })).tools).toEqual([]);
  });
});

describe('the trace', () => {
  it('turns the tools that touch the world into lines a person reads', async () => {
    const { traceFromTool } = await import('@/lib/reel/research/trace');
    expect(traceFromTool('WebSearch', { query: 'ltx license' })).toEqual({ kind: 'search', text: 'ltx license' });
    expect(traceFromTool('WebFetch', { url: 'https://www.a.b/c', prompt: 'find the license' })).toEqual({
      kind: 'read',
      text: 'a.b/c — find the license',
      url: 'https://www.a.b/c',
    });
    expect(traceFromTool('Task', { description: 'hunt github' })).toEqual({ kind: 'dispatch', text: 'hunt github' });
    expect(traceFromTool('Read', { file_path: 'x' })).toBeNull();
  });

  it('keeps every event when several land at once', async () => {
    const { appendTrace, readTrace, clearTrace } = await import('@/lib/reel/research/trace');
    await clearTrace('grok');
    await Promise.all([
      appendTrace('grok', { stage: 'hunt', kind: 'search', text: 'one' }),
      appendTrace('grok', { stage: 'hunt', kind: 'search', text: 'two' }),
      appendTrace('grok', { stage: 'hunt', kind: 'read', text: 'three', url: 'https://x' }),
    ]);
    expect((await readTrace('grok')).map((e) => e.text)).toEqual(['one', 'two', 'three']);
  });
});

describe('the plan', () => {
  it('folds back into the brief as the only queries the hunt may run', async () => {
    const { briefWithPlan } = await import('@/lib/reel/research/plan');
    const armed = briefWithPlan(BRIEF as never, {
      ...PLAN,
      queries: [
        { class: 'github', query: 'a', proves: 'the weights are open', why: 'w' },
        { class: 'github', query: 'b', proves: 'the weights are open', why: 'w' },
        { class: 'github', query: 'a', proves: 'inference is unlimited', why: 'dupe' },
        { class: 'docs', query: 'c', proves: 'inference is unlimited', why: 'w' },
      ],
    });
    expect(armed.searchQueries).toEqual([
      { class: 'github', queries: ['a', 'b'] },
      { class: 'docs', queries: ['c'] },
    ]);
    // A class the plan never named is not searched.
    expect(armed.sourceClasses).toEqual(['github', 'docs']);
  });

  it('is written by the planner without any tools, and refuses a query that proves nothing', async () => {
    const { planSearch } = await import('@/lib/reel/research/agents');
    const run = vi.fn(async (_p: string, opts?: { allowedTools?: string[] }) => {
      expect(opts?.allowedTools).toBeUndefined();
      return JSON.stringify({
        approach: 'repo first',
        queries: [{ class: 'github', query: 'LTX LICENSE', proves: 'the weights are open', why: 'primary' }],
      });
    });
    const plan = await planSearch(BRIEF as never, run);
    expect(plan.queries[0].query).toBe('LTX LICENSE');

    const bad = vi.fn(async () =>
      JSON.stringify({ approach: 'x', queries: [{ class: 'github', query: 'q', proves: '', why: 'w' }] })
    );
    await expect(planSearch(BRIEF as never, bad)).rejects.toThrow(/plan\.json/);
  });
});

describe('the local research service', () => {
  const runDoc = (status: string, steps: unknown[], sources: unknown[] = [], stopReason = 'finish') => ({
    research: { status, reportMd: '# r', stopReason },
    steps,
    sources,
  });
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('carries the whole approved plan in its one question', async () => {
    const { composeQuestion } = await import('@/lib/reel/research/local');
    const q = composeQuestion(BRIEF as never, PLAN);
    expect(q).toContain('the weights are open');
    expect(q).toContain('[github] LTX LICENSE');
    expect(q).toContain('Avoid this framing: hype');
  });

  it('polls the run, relays each step once, and returns the sources as a hunt', async () => {
    const { huntLocally } = await import('@/lib/reel/research/local');
    // The service's own step rows: tool by channel, arguments as JSON text.
    const search = { seq: 1, kind: 'tool_call', tool: 'search_web', args_json: '{"query":"ltx license"}', status: 'done' };
    const read = { seq: 2, kind: 'tool_call', tool: 'read_url', args_json: '{"url":"https://github.com/Lightricks/LTX-Video"}', status: 'done' };
    const polls = [
      runDoc('running', [search]),
      runDoc('running', [search, read]),
      runDoc('done', [search, read], [
        { title: 'LTX-Video', url: 'https://github.com/Lightricks/LTX-Video', channel: 'github' },
        { title: 'Docs', url: 'https://docs.example.org/ltx', channel: 'web' },
      ]),
    ];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/health')) return ok({ ollama: { ok: true, model: 'qwen' }, channels: [{ channel: 'searxng', ok: true }] });
      if (url.endsWith('/api/research')) return ok({ id: 'r1' });
      return ok(polls[Math.min(i++, polls.length - 1)]);
    }) as unknown as typeof fetch;

    const seen: string[] = [];
    const found = await huntLocally(BRIEF as never, PLAN, {
      baseUrl: 'http://svc',
      fetchImpl,
      pollMs: 1,
      onStep: (e) => seen.push(`${e.kind}:${e.text}`),
    });

    expect(seen.filter((s) => s.startsWith('search:'))).toEqual(['search:ltx license']);
    expect(seen.filter((s) => s.startsWith('read:'))).toHaveLength(1);
    expect(found.map((f) => f.class)).toEqual(['github', 'docs']);
    expect(found[0].publisher).toBe('github.com');
  });

  it('refuses to start when the service cannot search', async () => {
    const { huntLocally } = await import('@/lib/reel/research/local');
    const fetchImpl = vi.fn(async () =>
      ok({ ollama: { ok: false, model: 'qwen', recovery: 'docker compose up' }, channels: [] })
    ) as unknown as typeof fetch;
    await expect(huntLocally(BRIEF as never, PLAN, { baseUrl: 'http://svc', fetchImpl })).rejects.toThrow(
      /not ready.*docker compose up/
    );
  });
});

describe('the verifier', () => {
  const line = (id: string, text: string, citations: string[]) => ({
    id, order: 0, role: 'body' as const, text, citations, assetIds: [], note: null, commentary: false,
  });

  it("hands the model the sentences that carry each line's numbers, and keeps only real flags", async () => {
    const { verifyScript } = await import('@/lib/reel/research/agents');
    const candidates = [{ id: 'abcdef012345', title: 'Testing', summary: 's' }] as never;
    const padding = 'Menu Home About Download Support Purchase Search Documentation Changelog. '.repeat(8);
    const evidence = {
      abcdef012345: { text: `${padding}The library is 155.8 KSLOC of C. The tests are 92,053 KSLOC. ${padding}Unrelated closing.` },
    };
    const run = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('155.8 KSLOC');
      // The navigation run far from the figures is not handed over as evidence.
      expect(prompt).not.toContain('Unrelated closing');
      return JSON.stringify({ flags: [{ lineId: 'l1', issue: 'kilobytes is not KSLOC' }, { lineId: 'ghost', issue: 'x' }] });
    });
    const flags = await verifyScript([line('l1', 'That is 92,000 kilobytes against 155.8.', ['abcdef012345'])], candidates, evidence, run);
    expect(flags).toEqual([{ lineId: 'l1', issue: 'kilobytes is not KSLOC' }]);
  });

  it('asks nothing when no line is cited', async () => {
    const { verifyScript } = await import('@/lib/reel/research/agents');
    const run = vi.fn();
    const out = await verifyScript([{ ...line('l1', 'Opinion.', []), commentary: true }], [] as never, {}, run);
    expect(out).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
