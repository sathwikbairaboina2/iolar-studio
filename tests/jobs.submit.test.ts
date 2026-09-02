import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ResearchJob } from '@/lib/jobs/researchApi';

const sample = (JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { items: ResearchJob[] }).items;

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-submit-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

async function preparedCut(n: number) {
  const L = await import('@/lib/jobs/ledger');
  L.upsertPool(
    Array.from({ length: n }, (_, i) => {
      const base = sample[i % sample.length];
      return {
        researchId: 5000 + i,
        familyKey: `${base.familyKey}|${i}`,
        company: base.company,
        title: base.title,
        category: 'india',
        remote: base.remote,
        postedAt: '2026-09-01T10:00:00.000Z',
        raw: { ...base, id: 5000 + i, familyKey: `${base.familyKey}|${i}`, postedAt: '2026-09-01T10:00:00.000Z' },
      };
    }),
    '2026-09-02T00:00:00.000Z'
  );
  L.finishPull(L.startPull({ category: 'india' }, '2026-09-02T00:00:00.000Z'), { fetched: n, added: n, refreshed: 0, closed: 0 });
  const { prepareCut } = await import('@/lib/jobs/cut');
  return prepareCut('weekly', '2026-W36', {
    classify: async (t) => t.map(() => 'other'),
    brief: async () => '# brief',
    filter: { category: 'india', techOnly: false },
    now: new Date('2026-09-02T12:00:00.000Z'),
  });
}

type Call = { url: string; body?: Record<string, unknown> };
const board = (replies: Record<string, { status?: number; body?: unknown; fail?: boolean }>, calls: Call[] = []) => {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    const key = Object.keys(replies).find((k) => u.endsWith(k) || (k.startsWith('body:') && String(init?.body ?? '').includes(k.slice(5))));
    const r = replies[key ?? ''] ?? { status: 404, body: { ok: false, message: 'no route' } };
    if (r.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:26100');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('submitting a cut', () => {
  it('refuses a thin cut without force, before any call', async () => {
    const cut = await preparedCut(5);
    expect(cut.status).toBe('thin');
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f, calls } = board({});
    await expect(submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f })).rejects.toThrow(/thin .*force/);
    expect(calls).toHaveLength(0);
  });

  it('posts the list with the studio source and the brief, then summarises and plans, recording each reply', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f, calls } = board({
      '/api/weeks/2026-W36/jobs': { body: { ok: true, week: '2026-W36', counted: 25, rejected: 0 } },
      'body:"stage":"summarise"': { body: { ok: true, stage: 'summarised' } },
      'body:"stage":"plan"': { body: { ok: true, stage: 'planned' } },
    });
    const record = vi.fn(async () => {});
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f, record });
    expect(calls.map((c) => c.url)).toEqual(['http://x/api/weeks/2026-W36/jobs', 'http://x/api/weeks/2026-W36/run', 'http://x/api/weeks/2026-W36/run']);
    expect(calls[0].body).toMatchObject({ source: { kind: 'studio', cutId: cut.id }, brief: '# brief', force: false });
    expect((calls[0].body!.jobs as unknown[]).length).toBe(25);
    expect(out.cut.status).toBe('planned');
    expect(out.submissions.map((s) => [s.stage, s.error])).toEqual([
      ['imported', null],
      ['summarise', null],
      ['plan', null],
    ]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: 'planned' }), 1);
  });

  it('records a refusal from the board and marks the cut failed', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f } = board({ '/api/weeks/2026-W36/jobs': { status: 409, body: { ok: false, message: 'already has an export' } } });
    const out = await submitCut(cut.id, { baseUrl: 'http://x', fetchImpl: f });
    expect(out.cut.status).toBe('failed');
    expect(out.submissions.at(-1)).toMatchObject({ stage: null, error: 'already has an export' });
  });

  it('records a board that is down and marks the cut failed, without throwing', async () => {
    const cut = await preparedCut(25);
    const { submitCut } = await import('@/lib/jobs/submit');
    const { f } = board({ '/api/weeks/2026-W36/jobs': { fail: true } });
    const out = await submitCut(cut.id, { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(out.cut.status).toBe('failed');
    expect(out.submissions.at(-1)?.error).toMatch(/not answering/);
  });
});

describe('the cut in the graph', () => {
  it('merges a Cut node linked to its week and pull', async () => {
    const { FakeGraph, FakeVectors, FakeEmbed } = await import('@/lib/knowledge/fake');
    const { useStoresForTests } = await import('@/lib/knowledge/stores');
    const graph = new FakeGraph();
    useStoresForTests({ graph, vectors: new FakeVectors(), embed: new FakeEmbed() });
    const { recordCut } = await import('@/lib/knowledge/spaces/jobs');
    await recordCut({ id: 3, periodKey: '2026-W36', kind: 'weekly', counted: 25, rejected: 0, status: 'planned' }, 1);
    expect(graph.node('Cut', { id: 3 })?.props).toMatchObject({ space: 'jobs', periodKey: '2026-W36', status: 'planned' });
    const edge = [...graph.edges.values()].find((e) => e.rel === 'FROM_POOL');
    expect(edge?.to).toContain('2026-W36');
    expect(edge?.props.pullId).toBe(1);
  });
});
