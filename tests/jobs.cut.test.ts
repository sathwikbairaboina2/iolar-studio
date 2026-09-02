import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ResearchJob } from '@/lib/jobs/researchApi';

const sample = (JSON.parse(readFileSync('tests/fixtures/jobs-pool.sample.json', 'utf8')) as { items: ResearchJob[] }).items;

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-cut-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

/** N open India rows posted on a date, cloned from the sample so they map cleanly. */
async function seed(n: number, postedAt: string) {
  const L = await import('@/lib/jobs/ledger');
  const rows = Array.from({ length: n }, (_, i) => {
    const base = sample[i % sample.length];
    return {
      researchId: 5000 + i,
      familyKey: `${base.familyKey}|${i}`,
      company: base.company,
      title: base.title,
      category: 'india',
      remote: base.remote,
      postedAt,
      raw: { ...base, id: 5000 + i, familyKey: `${base.familyKey}|${i}`, postedAt },
    };
  });
  L.upsertPool(rows, '2026-09-02T00:00:00.000Z');
}

const opts = () => ({
  classify: vi.fn(async (t: string[]) => t.map(() => 'other')),
  brief: vi.fn(async () => '# The week\n\nA fine week.'),
  filter: { category: 'india' as const, techOnly: false },
  now: new Date('2026-09-02T12:00:00.000Z'),
});

describe('periods', () => {
  it('names ISO weeks and days and knows their windows', async () => {
    const { weekKey, dayKey, windowFor } = await import('@/lib/jobs/period');
    expect(weekKey(new Date('2026-09-02T12:00:00.000Z'))).toBe('2026-W36');
    expect(windowFor('2026-W36')).toEqual({ from: '2026-08-31', to: '2026-09-06', kind: 'weekly' });
    expect(weekKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-W01');
    expect(dayKey(new Date('2026-09-02T23:59:00.000Z'))).toBe('2026-09-02');
    expect(windowFor('2026-09-02')).toEqual({ from: '2026-09-02', to: '2026-09-02', kind: 'daily' });
    expect(() => windowFor('nope')).toThrow(/not a period/);
  });
});

describe('preparing a cut', () => {
  it('maps the window, computes tiles, keeps the brief, and is prepared when big enough', async () => {
    await seed(25, '2026-09-01T10:00:00.000Z');
    const { prepareCut } = await import('@/lib/jobs/cut');
    const o = opts();
    const cut = await prepareCut('weekly', undefined, o);
    expect(cut).toMatchObject({ periodKey: '2026-W36', kind: 'weekly', status: 'prepared', counted: 25, rejected: 0, briefMd: '# The week\n\nA fine week.' });
    const s = cut.summary as { counted: number; byFunction: { key: string; count: number }[]; topEmployers: unknown[] };
    expect(s.counted).toBe(25);
    expect(s.byFunction.length).toBeGreaterThan(0);
    // Every sample title is placed by rule; the model is asked at most once per cut.
    expect(o.classify.mock.calls.length).toBeLessThanOrEqual(1);
    const L = await import('@/lib/jobs/ledger');
    expect(L.cutRows(cut.id)).toHaveLength(25);
    expect(L.cutRows(cut.id).every((r) => r.cutId === cut.id)).toBe(true);
  });

  it('is thin under the threshold', async () => {
    await seed(12, '2026-09-01T10:00:00.000Z');
    const { prepareCut } = await import('@/lib/jobs/cut');
    const cut = await prepareCut('weekly', undefined, opts());
    expect(cut.status).toBe('thin');
    expect(cut.counted).toBe(12);
  });

  it('takes a daily window, and refuses a key of the wrong kind', async () => {
    await seed(3, '2026-09-02T09:00:00.000Z');
    const { prepareCut } = await import('@/lib/jobs/cut');
    const cut = await prepareCut('daily', '2026-09-02', opts());
    expect(cut).toMatchObject({ periodKey: '2026-09-02', kind: 'daily', counted: 3 });
    await expect(prepareCut('daily', '2026-W36', opts())).rejects.toThrow(/weekly period, not daily/);
  });

  it('replaces a prepared cut in place, and needs force once submitted', async () => {
    await seed(25, '2026-09-01T10:00:00.000Z');
    const { prepareCut } = await import('@/lib/jobs/cut');
    const L = await import('@/lib/jobs/ledger');
    const a = await prepareCut('weekly', undefined, opts());
    await seed(30, '2026-09-01T11:00:00.000Z');
    const b = await prepareCut('weekly', undefined, opts());
    expect(b.id).toBe(a.id);
    expect(b.counted).toBe(30);
    L.setCutStatus(a.id, 'submitted');
    await expect(prepareCut('weekly', undefined, opts())).rejects.toThrow(/force/);
    const c = await prepareCut('weekly', undefined, { ...opts(), force: true });
    expect(c.id).toBe(a.id);
    expect(c.status).toBe('prepared');
  });

  it('keeps going without a brief when research-plugin cannot write one', async () => {
    await seed(25, '2026-09-01T10:00:00.000Z');
    const { prepareCut } = await import('@/lib/jobs/cut');
    const cut = await prepareCut('weekly', undefined, {
      ...opts(),
      brief: async () => {
        throw new Error('down');
      },
    });
    expect(cut.briefMd).toBeNull();
    expect(cut.status).toBe('prepared');
  });
});
