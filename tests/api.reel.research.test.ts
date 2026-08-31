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
    await seedBrief();
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
