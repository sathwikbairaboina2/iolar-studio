import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-poolrows-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

const row = (id: number, over: Record<string, unknown> = {}) => ({
  researchId: id,
  familyKey: `acme|role ${id}`,
  company: 'Acme',
  title: `Role ${id}`,
  category: 'india',
  remote: false,
  postedAt: null,
  raw: { url: `https://acme.example/jobs/${id}`, location: 'Pune, Maharashtra, IN', salary: '₹1M - ₹2M INR', description: 'long text' },
  ...over,
});

const get = async (qs = '') => {
  const { GET } = await import('@/app/api/jobs/pool/rows/route');
  const res = await GET(new Request(`http://studio/api/jobs/pool/rows${qs}`));
  return { status: res.status, body: await res.json() };
};

describe('GET /api/jobs/pool/rows', () => {
  it('lists rows first seen since a date, newest first, with the listing url', async () => {
    const ledger = await import('@/lib/jobs/ledger');
    ledger.upsertPool([row(1), row(2)], '2026-11-10T00:00:00.000Z');
    ledger.upsertPool([row(3), row(4, { category: 'other' })], '2026-11-24T00:00:00.000Z');
    const r = await get('?since=2026-11-20T00:00:00.000Z&category=india');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items).toEqual([
      {
        researchId: 3, familyKey: 'acme|role 3', company: 'Acme', title: 'Role 3', category: 'india', remote: false,
        postedAt: null, firstSeen: '2026-11-24T00:00:00.000Z', lastSeen: '2026-11-24T00:00:00.000Z', closedAt: null,
        url: 'https://acme.example/jobs/3', location: 'Pune, Maharashtra, IN', salary: '₹1M - ₹2M INR',
      },
    ]);
  });

  it('includes rows closed since the date even when first seen earlier, and never the description', async () => {
    const ledger = await import('@/lib/jobs/ledger');
    ledger.upsertPool([row(1), row(2)], '2026-11-01T00:00:00.000Z');
    ledger.closeMissing([2], 'india', '2026-11-25T00:00:00.000Z');
    const r = await get('?since=2026-11-20T00:00:00.000Z');
    expect(r.body.items.map((i: { researchId: number }) => i.researchId)).toEqual([1]);
    expect(r.body.items[0].closedAt).toBe('2026-11-25T00:00:00.000Z');
    expect(JSON.stringify(r.body)).not.toContain('long text');
  });

  it('pages with limit and offset and reports the total', async () => {
    const ledger = await import('@/lib/jobs/ledger');
    ledger.upsertPool([row(1), row(2), row(3)], '2026-11-24T00:00:00.000Z');
    const a = await get('?limit=2&offset=0');
    const b = await get('?limit=2&offset=2');
    expect(a.body.total).toBe(3);
    expect(a.body.items).toHaveLength(2);
    expect(b.body.items).toHaveLength(1);
  });

  it('refuses a bad limit or since', async () => {
    expect((await get('?limit=0')).status).toBe(400);
    expect((await get('?limit=9999')).status).toBe(400);
    expect((await get('?since=yesterday')).status).toBe(400);
  });
});
