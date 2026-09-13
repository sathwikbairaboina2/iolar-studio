import { NextResponse } from 'next/server';
import { list as listExplainers } from '@/lib/explainer/store';
import { listReelsPage } from '@/lib/reel/store';
import { searchExplainers, searchHandbooks, searchReels, type SearchHit } from '@/lib/search';

/** How many reels are looked at. The shelf is small; reading all of it beats a half-search. */
const REEL_SCAN = 200;

/**
 * One box, every shelf. A short query answers from whatever is reachable: a shelf that throws —
 * an index not built yet, a data directory half-moved — costs its own hits, not the whole search.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  // One letter matches most of the studio, so it is not a search yet.
  if (q.length < 2) return NextResponse.json({ q, hits: [] });

  const [handbooks, explainers, reels] = await Promise.all([
    Promise.resolve().then(() => searchHandbooks(q)).catch(() => [] as SearchHit[]),
    listExplainers().then((rows) => searchExplainers(rows, q)).catch(() => [] as SearchHit[]),
    listReelsPage({ limit: REEL_SCAN })
      .then((page) => searchReels(page.reels, q))
      .catch(() => [] as SearchHit[]),
  ]);

  return NextResponse.json({ q, hits: [...handbooks, ...explainers, ...reels] });
}
