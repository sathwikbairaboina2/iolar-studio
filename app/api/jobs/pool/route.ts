import { NextResponse } from 'next/server';
import * as ledger from '@/lib/jobs/ledger';
import { defaultFilter, sourcesHealth } from '@/lib/jobs/researchApi';

/** The pool as the studio holds it, the last pull, and research-plugin's source health. */
export async function GET() {
  const filter = defaultFilter();
  const counts = ledger.poolCounts(filter.category);
  const last = ledger.lastPull();
  const sources = await sourcesHealth().catch((err) => ({ enabled: 0, total: 0, lastError: String(err instanceof Error ? err.message : err) }));
  return NextResponse.json({
    filter,
    counts: { total: counts.total, open: counts.open, closed: counts.closed, newSinceLastPull: last ? counts.newSince(last.at) : counts.total },
    lastPull: last,
    sources,
  });
}
