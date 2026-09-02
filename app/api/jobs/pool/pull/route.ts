import { NextResponse } from 'next/server';
import { pullPool } from '@/lib/jobs/pool';
import { defaultFilter } from '@/lib/jobs/researchApi';
import { logPlugin } from '@/lib/plugins/log';

export const maxDuration = 300;

/** Pull the pool now. The reply is the pulls row; an error is a field on it, not a status. */
export async function POST() {
  const filter = defaultFilter();
  logPlugin('research', `pulling the ${filter.category} job pool`, 'info');
  const out = await pullPool(filter);
  logPlugin(
    'research',
    out.error
      ? `pool pull failed: ${out.error}`
      : `pool pull: ${out.fetched} fetched, ${out.added} new, ${out.refreshed} refreshed, ${out.closed} closed`,
    out.error ? 'error' : 'success'
  );
  return NextResponse.json(out, { status: out.error ? 503 : 200 });
}
