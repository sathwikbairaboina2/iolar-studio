import { describe, it, expect, vi } from 'vitest';
import { huntSources, critique, draftScript, extractJson } from '@/lib/reel/research/agents';

/**
 * The three stages Claude runs. What matters here is the shape of the prompt —
 * what the model is told it may and may not do — and that a reply which is not
 * usable JSON fails loudly rather than half-parsing.
 */

const brief = {
  runId: 'grok',
  topic: 'LTX-Video open weights',
  angle: 'Open weights turn a per-pull lottery into a fixed hardware cost',
  audience: 'developers who self-host',
  videoFormat: 'reel',
  mustProve: ['the weights are genuinely open', 'local inference is unlimited'],
  mustInclude: ['Lightricks'],
  avoid: ['the usual AI hype framing'],
  recencyWindowDays: 90,
  sourceClasses: ['github', 'news'],
  searchQueries: [
    { class: 'github', queries: ['LTX-Video repo'] },
    { class: 'news', queries: ['LTX-Video open weights'] },
  ],
  referenceReel: null,
  status: 'briefed',
} as never;

const capture = (reply: string) => {
  const seen: { prompt: string; opts?: { allowedTools?: string[] } }[] = [];
  const run = vi.fn(async (prompt: string, opts?: { allowedTools?: string[] }) => {
    seen.push({ prompt, opts });
    return reply;
  });
  return { run, seen };
};

describe('extractJson', () => {
  it('reads a bare array', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('reads an object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('digs a fenced block out of surrounding prose', () => {
    expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```\nhope that helps')).toEqual([{ a: 1 }]);
  });

  it('refuses prose with no JSON in it, rather than returning nothing', () => {
    expect(() => extractJson('I could not find anything useful.')).toThrow(/could not read/i);
  });

  it('refuses truncated JSON instead of half-parsing it', () => {
    expect(() => extractJson('[{"a":1},{"b"')).toThrow(/could not read/i);
  });
});

describe('huntSources', () => {
  it('dispatches one subagent per source class, concurrently', async () => {
    const { run, seen } = capture('[]');
    await huntSources(brief, run);

    expect(seen[0].prompt).toMatch(/single message/i);
    expect(seen[0].prompt).toMatch(/github/);
    expect(seen[0].prompt).toMatch(/news/);
  });

  it('gives each class its own seeded queries', async () => {
    const { run, seen } = capture('[]');
    await huntSources(brief, run);

    expect(seen[0].prompt).toContain('LTX-Video repo');
    expect(seen[0].prompt).toContain('LTX-Video open weights');
  });

  it('allows the tools the hunt actually needs', async () => {
    const { run, seen } = capture('[]');
    await huntSources(brief, run);

    expect(seen[0].opts?.allowedTools).toContain('Task');
    expect(seen[0].opts?.allowedTools).toContain('WebSearch');
  });

  it('carries the recency window, so stale sources are not hunted', async () => {
    const { run, seen } = capture('[]');
    await huntSources(brief, run);

    expect(seen[0].prompt).toMatch(/90/);
  });

  it('returns what the hunters found', async () => {
    const { run } = capture('[{"url":"https://example.com","class":"news"}]');
    expect(await huntSources(brief, run)).toHaveLength(1);
  });
});

describe('critique', () => {
  it('shows the critic the brief it is judging against', async () => {
    const { run, seen } = capture('{"candidates":[]}');
    await critique(brief, [{ url: 'https://example.com' }] as never, run);

    expect(seen[0].prompt).toContain('the weights are genuinely open');
    expect(seen[0].prompt).toContain('per-pull lottery into a fixed hardware cost');
  });

  it('tells the critic what to avoid', async () => {
    const { run, seen } = capture('{"candidates":[]}');
    await critique(brief, [] as never, run);

    expect(seen[0].prompt).toContain('the usual AI hype framing');
  });

  it('does not let the critic search — it judges what was found', async () => {
    const { run, seen } = capture('{"candidates":[]}');
    await critique(brief, [] as never, run);

    expect(seen[0].opts?.allowedTools ?? []).not.toContain('WebSearch');
  });
});

describe('draftScript', () => {
  const candidates = [
    { id: 'a1b2c3d4e5f6', title: 'LTX-Video', publisher: 'github.com', summary: 'the repo', pullQuotes: [], stats: [] },
  ] as never;

  it('shows the model the sources it may cite, with their ids', async () => {
    const { run, seen } = capture('{"lines":[]}');
    await draftScript(brief, candidates, {}, run);

    expect(seen[0].prompt).toContain('a1b2c3d4e5f6');
  });

  it('prefers gathered evidence over the critic summary, and says so', async () => {
    const { run, seen } = capture('{"lines":[]}');
    await draftScript(brief, candidates, { a1b2c3d4e5f6: { text: 'what was actually said' } } as never, run);

    expect(seen[0].prompt).toContain('what was actually said');
    expect(seen[0].prompt).toMatch(/evidence/i);
  });

  it('requires a citation for every factual line', async () => {
    const { run, seen } = capture('{"lines":[]}');
    await draftScript(brief, candidates, {}, run);

    expect(seen[0].prompt).toMatch(/commentary/);
    expect(seen[0].prompt).toMatch(/citation/i);
  });

  it('does not let the script stage go looking for new sources', async () => {
    const { run, seen } = capture('{"lines":[]}');
    await draftScript(brief, candidates, {}, run);

    expect(seen[0].opts?.allowedTools ?? []).not.toContain('WebSearch');
  });

  it('returns the lines the model wrote', async () => {
    const { run } = capture('{"lines":[{"id":"l1","order":0,"role":"hook","text":"x","citations":[],"assetIds":[],"note":null}]}');
    expect((await draftScript(brief, candidates, {}, run)).length).toBe(1);
  });
});
