import * as ledger from './ledger';
import { listPool, ResearchDown, type PoolFilter, type ResearchJob, type ResearchOpts } from './researchApi';

/**
 * A pull: page the research pool into the ledger and diff it against the last pull.
 * One `pulls` row per call, written first; a research-plugin that is down is that row
 * with an error, never a throw to the page.
 */

// research-plugin caps a page at 200 whatever `limit` says; `total` says when to stop.
const PAGE = 200;

export type PullResult = { pullId: number; fetched: number; added: number; refreshed: number; closed: number; error: string | null };

const toUpsert = (j: ResearchJob): ledger.PoolUpsert => ({
  researchId: j.id,
  familyKey: j.familyKey,
  company: j.company,
  title: j.title,
  category: j.category,
  remote: j.remote,
  postedAt: j.postedAt,
  raw: j as unknown as Record<string, unknown>,
});

export async function pullPool(filter: PoolFilter, opts: ResearchOpts & { now?: string } = {}): Promise<PullResult> {
  const now = opts.now ?? new Date().toISOString();
  const pullId = ledger.startPull(filter as unknown as Record<string, unknown>, now);
  const seen: number[] = [];
  let added = 0;
  let refreshed = 0;
  try {
    for (let offset = 0; ; offset += PAGE) {
      const { items, total } = await listPool(filter, { limit: PAGE, offset }, opts);
      const r = ledger.upsertPool(items.map(toUpsert), now);
      added += r.added;
      refreshed += r.refreshed;
      seen.push(...items.map((i) => i.id));
      if (items.length === 0 || seen.length >= total || offset + PAGE > 20_000) break;
    }
    // A category filter that is 'all' returned every open row, so anything missing is closed.
    const closed = filter.category === 'all' ? closeAll(seen, now) : ledger.closeMissing(seen, filter.category, now);
    ledger.finishPull(pullId, { fetched: seen.length, added, refreshed, closed });
    return { pullId, fetched: seen.length, added, refreshed, closed, error: null };
  } catch (err) {
    const error = err instanceof ResearchDown ? err.message : String(err instanceof Error ? err.message : err);
    ledger.finishPull(pullId, { fetched: seen.length, added, refreshed, closed: 0, error });
    return { pullId, fetched: seen.length, added, refreshed, closed: 0, error };
  }
}

function closeAll(seen: number[], now: string): number {
  return ['india', 'global-remote', 'other'].reduce((n, c) => n + ledger.closeMissing(seen, c, now), 0);
}
