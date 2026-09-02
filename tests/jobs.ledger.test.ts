import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-ledger-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

const row = (id: number, over: Record<string, unknown> = {}) => ({
  researchId: id,
  familyKey: `acme|role-${id}`,
  company: 'Acme',
  title: `Role ${id}`,
  category: 'india',
  remote: false,
  postedAt: '2026-09-01T10:00:00.000Z',
  raw: { id, title: `Role ${id}` },
  ...over,
});

describe('the pool', () => {
  it('adds on first sight, refreshes after, and closes what a pull no longer returns', async () => {
    const L = await import('@/lib/jobs/ledger');
    expect(L.upsertPool([row(1), row(2)], '2026-09-02T00:00:00.000Z')).toEqual({ added: 2, refreshed: 0 });
    expect(L.upsertPool([row(1), row(2)], '2026-09-03T00:00:00.000Z')).toEqual({ added: 0, refreshed: 2 });
    expect(L.closeMissing([1], 'india', '2026-09-04T00:00:00.000Z')).toBe(1);
    const open = L.poolInWindow('2026-08-31', '2026-09-06', 'india');
    expect(open.map((r) => r.researchId)).toEqual([1]);
    expect(L.poolCounts('india')).toMatchObject({ total: 2, open: 1, closed: 1 });
    expect(L.poolCounts('india').newSince('2026-09-02T00:00:00.000Z')).toBe(2);
  });

  it('windows on the posted date, or first sight when the source gave none', async () => {
    const L = await import('@/lib/jobs/ledger');
    L.upsertPool([row(1, { postedAt: '2026-08-20T00:00:00.000Z' }), row(2, { postedAt: null })], '2026-09-02T00:00:00.000Z');
    expect(L.poolInWindow('2026-08-31', '2026-09-06', 'india').map((r) => r.researchId)).toEqual([2]);
    expect(L.poolInWindow('2026-08-17', '2026-08-23', 'india').map((r) => r.researchId)).toEqual([1]);
  });

  it('keeps a pull row per pull, error included', async () => {
    const L = await import('@/lib/jobs/ledger');
    const id = L.startPull({ category: 'india' });
    L.finishPull(id, { fetched: 0, added: 0, refreshed: 0, closed: 0, error: 'ECONNREFUSED' });
    expect(L.lastPull()).toMatchObject({ id, error: 'ECONNREFUSED', filter: { category: 'india' } });
  });
});

describe('cuts', () => {
  const cut = (status: 'prepared' | 'thin' = 'prepared') => ({
    periodKey: '2026-W36',
    kind: 'weekly' as const,
    windowFrom: '2026-08-31',
    windowTo: '2026-09-06',
    filter: { category: 'india' },
    status,
    counted: 3,
    rejected: 1,
    summary: { total: 3 },
    briefMd: '# brief',
  });

  it('one cut per period and kind, replaced in place while it is only prepared', async () => {
    const L = await import('@/lib/jobs/ledger');
    const a = L.createCut(cut());
    const b = L.createCut({ ...cut('thin'), counted: 2 });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('thin');
    expect(L.listCuts()).toHaveLength(1);
  });

  it('refuses to replace a cut that was submitted, unless told to', async () => {
    const L = await import('@/lib/jobs/ledger');
    const a = L.createCut(cut());
    L.setCutStatus(a.id, 'submitted');
    expect(() => L.createCut(cut())).toThrow(/force/);
    expect(L.createCut(cut(), { replaceSubmitted: true }).id).toBe(a.id);
  });

  it('keeps rows and submissions against the cut', async () => {
    const L = await import('@/lib/jobs/ledger');
    const a = L.createCut(cut());
    L.replaceCutRows(a.id, [
      { cutId: a.id, researchId: 1, row: { id: 'x' }, mappedBy: 'rule', rejectReason: null },
      { cutId: a.id, researchId: 2, row: null, mappedBy: 'rejected', rejectReason: 'no url' },
    ]);
    expect(L.cutRows(a.id).map((r) => r.mappedBy)).toEqual(['rejected', 'rule']);
    const s = L.addSubmission({ cutId: a.id, at: 'now', accepted: 3, rejected: 1, stage: 'planned', reply: { ok: true }, error: null });
    expect(L.submissionsFor(a.id)).toEqual([s]);
  });
});
