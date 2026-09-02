import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const sample = JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { total: number; items: Record<string, unknown>[] };

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-pool-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

type Call = { url: string; init?: RequestInit };
const fetchWith = (reply: (url: string) => { status?: number; body?: unknown; fail?: boolean }, calls: Call[] = []) => {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url);
    if (r.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:25100');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('the research client', () => {
  it('asks for the pool with the parameter names research-plugin reads', async () => {
    const { listPool } = await import('@/lib/jobs/researchApi');
    const { f, calls } = fetchWith(() => ({ body: sample }));
    const out = await listPool({ category: 'india', techOnly: false }, { limit: 500, offset: 0 }, { baseUrl: 'http://127.0.0.1:25100', fetchImpl: f });
    expect(calls[0].url).toBe('http://127.0.0.1:25100/api/jobs?category=india&tech=0&group=1&limit=500&offset=0');
    expect(out.total).toBe(sample.total);
    expect(out.items).toHaveLength(12);
  });

  it('reads source health as enabled over total', async () => {
    const { sourcesHealth } = await import('@/lib/jobs/researchApi');
    const { f } = fetchWith(() => ({ body: { sources: [{ enabled: true, lastError: null }, { enabled: false, lastError: 'boom' }] } }));
    expect(await sourcesHealth({ baseUrl: 'http://x', fetchImpl: f })).toEqual({ enabled: 1, total: 2, lastError: 'boom' });
  });
});

describe('a pull', () => {
  it('pages until a short page, writes one pulls row, and diffs against the last pull', async () => {
    const { pullPool } = await import('@/lib/jobs/pool');
    const L = await import('@/lib/jobs/ledger');
    const first = sample.items.slice(0, 8);
    const { f, calls } = fetchWith(() => ({ body: { total: 8, items: first } }));
    const a = await pullPool({ category: 'india', techOnly: false }, { baseUrl: 'http://x', fetchImpl: f, now: '2026-09-02T00:00:00.000Z' });
    expect(a).toMatchObject({ fetched: 8, added: 8, refreshed: 0, closed: 0, error: null });
    expect(calls).toHaveLength(1);

    // Next day: two are gone, one is new.
    const second = [...sample.items.slice(2, 8), sample.items[10]];
    const g = fetchWith(() => ({ body: { total: 7, items: second } }));
    const b = await pullPool({ category: 'india', techOnly: false }, { baseUrl: 'http://x', fetchImpl: g.f, now: '2026-09-03T00:00:00.000Z' });
    expect(b).toMatchObject({ fetched: 7, added: 1, refreshed: 6, closed: 2, error: null });
    expect(L.poolCounts('india')).toMatchObject({ total: 9, open: 7, closed: 2 });
    expect(L.lastPull()).toMatchObject({ id: b.pullId, closed: 2 });
  });

  it('pages when a page is full', async () => {
    const { pullPool } = await import('@/lib/jobs/pool');
    const big = Array.from({ length: 500 }, (_, i) => ({ ...sample.items[0], id: 1000 + i, familyKey: `f${i}` }));
    const { f, calls } = fetchWith((url) => (url.includes('offset=0') ? { body: { total: 503, items: big } } : { body: { total: 503, items: sample.items.slice(0, 3) } }));
    const out = await pullPool({ category: 'india', techOnly: false }, { baseUrl: 'http://x', fetchImpl: f });
    expect(calls.map((c) => c.url.match(/offset=(\d+)/)![1])).toEqual(['0', '500']);
    expect(out.fetched).toBe(503);
  });

  it('is a pulls row with an error when research-plugin is down, and throws nothing', async () => {
    const { pullPool } = await import('@/lib/jobs/pool');
    const L = await import('@/lib/jobs/ledger');
    const { f } = fetchWith(() => ({ fail: true }));
    const out = await pullPool({ category: 'india', techOnly: false }, { baseUrl: 'http://127.0.0.1:25100', fetchImpl: f });
    expect(out.error).toMatch(/not answering on http:\/\/127\.0\.0\.1:25100/);
    expect(L.lastPull()?.error).toBe(out.error);
  });
});
