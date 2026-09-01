import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The research graph on the local model: six agents, three gates. The runner is a
 * scripted model — it answers by what the prompt is asking for — and the hunter is a
 * scripted research service.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-graph-'));
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
  avoid: [],
  recencyWindowDays: 90,
  sourceClasses: ['github', 'docs'],
  searchQueries: [{ class: 'github', queries: ['x'] }],
  referenceReel: null,
  status: 'briefed',
};

const CANDIDATE = {
  id: 'a1b2c3d4e5f6',
  sourceClass: 'github',
  url: 'https://github.com/Lightricks/LTX-Video',
  canonicalUrl: 'https://github.com/Lightricks/LTX-Video',
  title: 'LTX-Video',
  publisher: 'github.com',
  author: null,
  publishedAt: null,
  retrievedAt: '2026-08-30T21:40:00.000Z',
  thumbnailUrl: null,
  durationSec: null,
  summary: 'the official repo',
  pullQuotes: [],
  stats: [],
  assetKind: 'repo',
  clipWindow: null,
  whyItMatters: 'proves the weights are open',
  scores: { relevance: 5, authority: 5, recency: 4, uniqueness: 5, usability: 4 },
  scoreTotal: 92,
  verdict: 'keep',
  rejectReason: null,
  dupeOf: null,
  hunterAgent: 'source-hunter',
  fetchPlan: { method: 'gh', target: 'https://github.com/Lightricks/LTX-Video', note: null },
  risk: { paywall: false, licence: null, unstable: false },
};

/** A model that answers by what it is being asked for. */
const scripted = vi.fn(async (prompt: string, _opts?: { allowedTools?: string[] }) => {
  if (prompt.includes('write the plan')) {
    return JSON.stringify({
      approach: 'repo first',
      queries: [{ class: 'github', query: 'Lightricks LTX-Video LICENSE', proves: 'the weights are open', why: 'primary' }],
    });
  }
  if (prompt.includes('adversarial critic')) return JSON.stringify({ candidates: [CANDIDATE] });
  if (prompt.includes('Write the narration')) {
    return JSON.stringify({
      lines: [
        { id: 'l1', order: 0, role: 'hook', text: 'The weights are open.', citations: ['a1b2c3d4e5f6'], assetIds: [], note: null, commentary: false },
        { id: 'l2', order: 1, role: 'close', text: 'So the lottery is over.', citations: [], assetIds: [], note: null, commentary: true },
      ],
    });
  }
  if (prompt.includes('checking a short video script against the sources')) {
    return JSON.stringify({ flags: [{ lineId: 'l1', issue: 'the source says 155.8 KSLOC, the line says kilobytes' }] });
  }
  if (prompt.includes('checking whether a short video script')) {
    return JSON.stringify({ coverage: [{ claim: 'the weights are open', lineIds: ['l1'], why: 'says so' }, { claim: 'inference is unlimited', lineIds: [], why: 'never said' }] });
  }
  throw new Error(`unscripted prompt: ${prompt.slice(0, 80)}`);
});

/** A research service that runs one search, reads one page, and finishes. */
function service() {
  const steps = [
    { seq: 1, kind: 'tool_call', tool: 'search_web', args_json: '{"query":"Lightricks LTX-Video LICENSE"}', status: 'done' },
    { seq: 2, kind: 'tool_call', tool: 'read_url', args_json: '{"url":"https://github.com/Lightricks/LTX-Video"}', status: 'done' },
  ];
  let polls = 0;
  const posted: unknown[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith('/api/health')) return ok({ ollama: { ok: true, model: 'qwen' }, channels: [{ channel: 'searxng', ok: true }] });
    if (url.endsWith('/api/research')) {
      posted.push(JSON.parse(String(init?.body)));
      return ok({ id: 'r1' });
    }
    polls += 1;
    return ok({
      research: { status: polls < 2 ? 'running' : 'done', stopReason: 'finish' },
      steps: steps.slice(0, polls),
      sources: polls < 2 ? [] : [{ title: 'LTX-Video', url: 'https://github.com/Lightricks/LTX-Video', channel: 'github' }],
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, posted };
}

async function seed(status = 'briefed') {
  const store = await import('@/lib/reel/research/store');
  await store.writeBrief('grok', { ...BRIEF, status } as never);
  return store;
}

const deps = (fetchImpl?: typeof fetch) => ({ run: scripted, researchUrl: 'http://svc', fetchImpl, huntPollMs: 1 });

describe('the research graph', () => {
  it('plans first and stops at the plan gate', async () => {
    await seed();
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    const out = await advanceResearch('grok', deps());
    expect(out.status).toBe('planned');
    expect(out.waitingOn).toBe('plan');
    const store = await import('@/lib/reel/research/store');
    expect((await store.readPlan('grok'))?.queries[0].query).toBe('Lightricks LTX-Video LICENSE');
  });

  it('holds at the gate until the plan comes back approved', async () => {
    await seed('planned');
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    const out = await advanceResearch('grok', deps());
    expect(out.status).toBe('planned');
    expect(out.waitingOn).toBe('plan');
  });

  it('hunts on the service with the approved plan, judges the pack, and stops for review', async () => {
    await seed('planned');
    const svc = service();
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    const plan = { approach: 'repo first', queries: [{ class: 'github', query: 'Lightricks LTX-Video LICENSE', proves: 'the weights are open', why: 'primary' }] };

    const out = await advanceResearch('grok', deps(svc.fetchImpl), { plan });

    expect(out.status).toBe('critiqued');
    expect(out.waitingOn).toBe('review');
    // The service got the plan as its own field, not only folded into the question.
    expect((svc.posted[0] as { plan: { queries: unknown[] } }).plan.queries).toHaveLength(1);
    // The hunt and the judgement landed on disk, and the trace shows the search.
    const store = await import('@/lib/reel/research/store');
    expect(await store.readHunt('grok')).toHaveLength(1);
    expect((await store.readCandidates('grok')).candidates[0].url).toContain('LTX-Video');
    const { readTrace } = await import('@/lib/reel/research/trace');
    const trace = await readTrace('grok');
    expect(trace.some((e) => e.kind === 'search' && e.text === 'Lightricks LTX-Video LICENSE')).toBe(true);
    expect(trace.some((e) => e.kind === 'read' && e.url?.includes('LTX-Video'))).toBe(true);
  });

  it('gathers, writes and judges in one stretch, then waits for approval', async () => {
    scripted.mockClear();
    const store = await seed('reviewed');
    await store.writeCandidates('grok', {
      runId: 'grok',
      generatedAt: '2026-08-30T21:40:00.000Z',
      criticVersion: '1',
      stats: { perClass: {}, totalFound: 1, totalKept: 1, dupesCollapsed: 0 },
      candidates: [CANDIDATE],
    } as never);
    vi.doMock('@/lib/reel/research/gatherRun', () => ({ gatherEvidence: async () => 1 }));
    const { advanceResearch } = await import('@/lib/reel/research/graph');

    const out = await advanceResearch('grok', deps());

    expect(out.status).toBe('drafted');
    expect(out.waitingOn).toBe('approval');
    const script = await store.readScript('grok');
    expect(script.lines).toHaveLength(2);
    // The judge read the script: one claim covered, one not.
    expect(script.unsupported).toEqual(['inference is unlimited']);
    // The verifier read it against the sources: one line says what its source does not.
    expect(script.flags).toEqual([{ lineId: 'l1', issue: 'the source says 155.8 KSLOC, the line says kilobytes' }]);
    // The writer was sent back once for length (the scripted draft is nine words) and
    // once with the verifier's objection — and once only for each.
    const drafts = scripted.mock.calls.map((c) => c[0]).filter((p) => p.includes('Write the narration'));
    expect(drafts).toHaveLength(3);
    expect(drafts[1]).toContain('too short');
    expect(drafts[2]).toContain('rejected these lines');
    expect(drafts[2]).toContain('kilobytes');
    vi.doUnmock('@/lib/reel/research/gatherRun');
  });

  it('never runs a thinking agent with tools', async () => {
    await seed();
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    await advanceResearch('grok', deps());
    for (const call of scripted.mock.calls) {
      expect(call[1]?.allowedTools).toBeUndefined();
    }
  });
});
