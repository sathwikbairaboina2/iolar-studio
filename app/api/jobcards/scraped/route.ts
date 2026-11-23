import { NextResponse } from 'next/server';
import { listRows } from '@/lib/jobcard/store';
import { listScraped, ScraperUnreachable } from '@/lib/jobcard/scraped';

/**
 * The posts instascraper has queued for recreation, each with the card already made from
 * it (matched on the post's URL) so the pane can say "Open card" instead of making a twin.
 */
export async function GET() {
  try {
    const items = await listScraped();
    const byUrl = new Map<string, string>();
    // listRows is newest first; keep the newest card for a post.
    for (const row of listRows()) if (row.sourceUrl && !byUrl.has(row.sourceUrl)) byUrl.set(row.sourceUrl, row.id);
    return NextResponse.json({ items: items.map((i) => ({ ...i, cardId: byUrl.get(i.igUrl) ?? null })) });
  } catch (err) {
    if (err instanceof ScraperUnreachable) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
