import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The studio's side of the research flow. `run` advances one stage per call and
 * stops at the two gates, so the state machine lives on the server rather than
 * in whatever the browser last remembered.
 */

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-research-api-'));
  vi.resetModules();
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const post = (body: unknown = {}) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown) => new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) });

const BRIEF = {
  runId: 'grok',
  createdAt: '2026-08-30T21:40:00.000Z',
  topic: 'LTX-Video open weights',
  angle: 'Open weights turn a lottery into a fixed cost',
  audience: 'developers who self-host',
  videoFormat: 'reel',
  mustProve: ['the weights are open', 'inference is unlimited'],
  mustInclude: [],
  avoid: [],
  recencyWindowDays: 90,
  sourceClasses: ['github'],
  searchQueries: [{ class: 'github', queries: ['LTX-Video'] }],
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

async function seedBrief(over: Record<string, unknown> = {}) {
  const store = await import('@/lib/reel/research/store');
  await store.writeBrief('grok', { ...BRIEF, ...over } as never);
  return store;
}

async function seedCandidates() {
  const store = await import('@/lib/reel/research/store');
  await store.writeCandidates('grok', {
    runId: 'grok',
    generatedAt: '2026-08-30T21:40:00.000Z',
    criticVersion: '1',
    stats: { perClass: {}, totalFound: 1, totalKept: 1, dupesCollapsed: 0 },
    candidates: [CANDIDATE],
  } as never);
}

describe('GET /api/reel/[slug]/research', () => {
  it('reports no research for a reel that has none', async () => {
    const { GET } = await import('@/app/api/reel/[slug]/research/route');
    const body = await (await GET(new Request('http://localhost/x'), ctx('grok'))).json();

    expect(body.status).toBeNull();
  });

  it('returns the brief and where the run stopped', async () => {
    await seedBrief({ status: 'critiqued' });
    const { GET } = await import('@/app/api/reel/[slug]/research/route');
    const body = await (await GET(new Request('http://localhost/x'), ctx('grok'))).json();

    expect(body.status).toBe('critiqued');
    expect(body.brief.topic).toBe('LTX-Video open weights');
  });
});

describe('POST /api/reel/[slug]/research/run', () => {
  it('saves the brief on the first call and stops there', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const res = await POST(post({ brief: BRIEF }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('briefed');
  });

  it('refuses a brief that does not validate rather than half-saving it', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const res = await POST(post({ brief: { ...BRIEF, mustProve: ['only one'] } }), ctx('grok'));

    expect(res.status).toBe(400);
  });

  // The critic is asked for candidates and nothing else. It used to be asked
  // for stats as well, and its answer overwrote the counts the route had just
  // computed — a perClass of plain numbers where the schema wants objects,
  // which threw away eleven minutes of searching at the write.
  it('keeps its own stats when the critic volunteers a set of its own', async () => {
    await seedBrief({ status: 'hunted' });
    const seeded = await import('@/lib/reel/research/store');
    await seeded.writeHunt('grok', [{ url: 'https://github.com/x' }]);
    vi.doMock('@/lib/reel/research/agents', () => ({
      huntSources: async () => [{ url: 'https://github.com/x' }],
      critique: async () => ({
        stats: { perClass: { github: 1 }, totalFound: 1, totalKept: 1, dupesCollapsed: 0 },
        candidates: [CANDIDATE],
      }),
    }));

    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const res = await POST(post(), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('critiqued');
    const store = await import('@/lib/reel/research/store');
    expect((await store.readCandidates('grok')).stats.perClass).toEqual({});
  });

  // The hunt is ten minutes of searching. It used to live only in memory until
  // the critic had finished and the pack validated, so any failure in between
  // threw all of it away.
  it('lands the hunt on disk before the critic runs, and stops there', async () => {
    await seedBrief();
    vi.doMock('@/lib/reel/research/agents', () => ({
      huntSources: async () => [{ url: 'https://github.com/x' }],
      critique: async () => {
        throw new Error('the critic should not have run yet');
      },
    }));

    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const body = await (await POST(post(), ctx('grok'))).json();

    expect(body.status).toBe('hunted');
    const store = await import('@/lib/reel/research/store');
    expect(await store.readHunt('grok')).toHaveLength(1);
  });

  it('judges what is already on disk rather than searching again', async () => {
    await seedBrief({ status: 'hunted' });
    const store = await import('@/lib/reel/research/store');
    await store.writeHunt('grok', [{ url: 'https://github.com/Lightricks/LTX-Video' }]);

    const hunt = vi.fn();
    vi.doMock('@/lib/reel/research/agents', () => ({
      huntSources: hunt,
      critique: async () => ({ candidates: [CANDIDATE] }),
    }));

    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const body = await (await POST(post(), ctx('grok'))).json();

    expect(body.status).toBe('critiqued');
    expect(hunt).not.toHaveBeenCalled();
  });

  // The gate: the user reviews before anything is gathered or written.
  it('stops after the critic and waits to be reviewed', async () => {
    await seedBrief({ status: 'critiqued' });
    await seedCandidates();
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const body = await (await POST(post(), ctx('grok'))).json();

    expect(body.status).toBe('critiqued');
    expect(body.waitingOn).toBe('review');
  });

  it('stops after drafting and waits to be approved', async () => {
    await seedBrief({ status: 'drafted' });
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const body = await (await POST(post(), ctx('grok'))).json();

    expect(body.waitingOn).toBe('approval');
  });

  it('says there is nothing left to do once approved', async () => {
    await seedBrief({ status: 'approved' });
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const body = await (await POST(post(), ctx('grok'))).json();

    expect(body.done).toBe(true);
  });

  it('will not run a stage for a reel with no research at all', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/research/run/route');
    const res = await POST(post(), ctx('grok'));

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/reel/[slug]/research/selection', () => {
  it('records what the user kept and marks the run reviewed', async () => {
    await seedBrief({ status: 'critiqued' });
    await seedCandidates();
    const { PUT } = await import('@/app/api/reel/[slug]/research/selection/route');
    const res = await PUT(
      put({ decisions: { a1b2c3d4e5f6: { state: 'keep', starred: false, note: null } } }),
      ctx('grok')
    );

    expect(res.status).toBe(200);
    const store = await import('@/lib/reel/research/store');
    expect(await store.researchStatus('grok')).toBe('reviewed');
  });

  // Reviewing everything away is a decision, but it leaves nothing to script.
  it('refuses a review that keeps nothing', async () => {
    await seedBrief({ status: 'critiqued' });
    await seedCandidates();
    const { PUT } = await import('@/app/api/reel/[slug]/research/selection/route');
    const res = await PUT(
      put({ decisions: { a1b2c3d4e5f6: { state: 'reject', starred: false, note: null } } }),
      ctx('grok')
    );

    expect(res.status).toBe(409);
  });
});

describe('PUT /api/reel/[slug]/research/script', () => {
  let order = 0;
  const LINE = (id: string, text: string, over: Record<string, unknown> = {}) => ({
    id,
    order: order++,
    role: 'body',
    text,
    citations: ['a1b2c3d4e5f6'],
    assetIds: [],
    note: null,
    commentary: false,
    ...over,
  });
  const CLAIM = 'the weights are open';

  async function seedScript() {
    await seedBrief({ status: 'drafted' });
    const store = await import('@/lib/reel/research/store');
    await store.writeScript('grok', {
      runId: 'grok',
      createdAt: '2026-08-30T21:40:00.000Z',
      updatedAt: '2026-08-30T21:40:00.000Z',
      status: 'draft',
      lines: [LINE('l1', 'Apache 2.0, and the weights are on Hugging Face.'), LINE('l2', 'Second line.')],
      unsupported: [],
      coverage: [{ claim: CLAIM, lineIds: ['l1'], why: 'names the licence' }],
    } as never);
    return store;
  }

  // Dropping a line is answerable from the stored judgement, so it costs nothing.
  it('surfaces a claim as unsupported when its only line is dropped, without asking the model', async () => {
    await seedScript();
    const judge = vi.fn();
    vi.doMock('@/lib/reel/research/agents', () => ({ judgeCoverage: judge }));

    const { PUT } = await import('@/app/api/reel/[slug]/research/script/route');
    const res = await PUT(put({ lines: [LINE('l2', 'Second line.')] }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unsupported).toContain(CLAIM);
    expect(judge).not.toHaveBeenCalled();
  });

  it('leaves the claim alone while its line is untouched', async () => {
    await seedScript();
    vi.doMock('@/lib/reel/research/agents', () => ({ judgeCoverage: vi.fn() }));

    const { PUT } = await import('@/app/api/reel/[slug]/research/script/route');
    const body = await (
      await PUT(put({ lines: [LINE('l1', 'Apache 2.0, and the weights are on Hugging Face.')] }), ctx('grok'))
    ).json();

    expect(body.unsupported).not.toContain(CLAIM);
  });

  // Rewriting a line destroys the text the judge read, so its answer no longer applies.
  it('re-judges when a line’s text is rewritten', async () => {
    await seedScript();
    const judge = vi.fn().mockResolvedValue([{ claim: CLAIM, lineIds: [], why: 'no longer said' }]);
    vi.doMock('@/lib/reel/research/agents', () => ({ judgeCoverage: judge }));

    const { PUT } = await import('@/app/api/reel/[slug]/research/script/route');
    const body = await (await PUT(put({ lines: [LINE('l1', 'Something else entirely.')] }), ctx('grok'))).json();

    expect(judge).toHaveBeenCalled();
    expect(body.unsupported).toContain(CLAIM);
  });

  it('keeps the judgement it has when a re-judge fails', async () => {
    await seedScript();
    vi.doMock('@/lib/reel/research/agents', () => ({
      judgeCoverage: vi.fn().mockRejectedValue(new Error('claude down')),
    }));

    const { PUT } = await import('@/app/api/reel/[slug]/research/script/route');
    const res = await PUT(put({ lines: [LINE('l1', 'Reworded, but still about the licence.')] }), ctx('grok'));

    expect(res.status).toBe(200);
    expect((await res.json()).unsupported).not.toContain(CLAIM);
  });
});
