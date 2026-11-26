import { NextResponse } from 'next/server';
import * as ledger from '@/lib/jobs/ledger';
import { defaultFilter } from '@/lib/jobs/researchApi';

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * The pool's rows for the control room, read-only: those first seen (or closed) since a
 * date, lean, without the description. `closedAt` set means the listing is gone.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const since = q.get('since') ?? '1970-01-01T00:00:00.000Z';
  const limit = q.get('limit') === null ? 100 : Number(q.get('limit'));
  const offset = q.get('offset') === null ? 0 : Number(q.get('offset'));
  const category = q.get('category') ?? defaultFilter().category;
  if (Number.isNaN(Date.parse(since))) return NextResponse.json({ error: 'since must be an ISO date' }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return NextResponse.json({ error: 'limit must be an integer from 1 to 500' }, { status: 400 });
  if (!Number.isInteger(offset) || offset < 0) return NextResponse.json({ error: 'offset must be a non-negative integer' }, { status: 400 });
  if (!['india', 'global-remote', 'other', 'all'].includes(category)) return NextResponse.json({ error: 'unknown category' }, { status: 400 });

  const { total, rows } = ledger.poolSince(since, category, limit, offset);
  return NextResponse.json({
    total,
    items: rows.map((r) => ({
      researchId: r.researchId,
      familyKey: r.familyKey,
      company: r.company,
      title: r.title,
      category: r.category,
      remote: r.remote,
      postedAt: r.postedAt,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      closedAt: r.closedAt,
      url: str(r.raw.url),
      location: str(r.raw.location),
      salary: str(r.raw.salary),
    })),
  });
}
