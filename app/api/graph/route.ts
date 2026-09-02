import { NextResponse } from 'next/server';
import { spaceGraph, crossLinks, labelSearch, meaningSearch } from '@/lib/knowledge/view';
import { chapterContext } from '@/lib/knowledge/spaces/handbooks';

/** One space per call. `ask` is the meaning search: what the agents would see. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get('space') ?? 'handbooks';
  const q = url.searchParams.get('q');
  const ask = url.searchParams.get('ask');
  const subject = url.searchParams.get('subject');
  const chapter = url.searchParams.get('chapter');
  try {
    if (subject && chapter) return NextResponse.json(await chapterContext(subject, chapter));
    if (ask) return NextResponse.json({ hits: await meaningSearch(space, ask) });
    if (q) return NextResponse.json({ nodes: await labelSearch(space, q) });
    if (space === 'all') return NextResponse.json(await crossLinks());
    if (space !== 'handbooks' && space !== 'reels' && space !== 'jobs') {
      return NextResponse.json({ error: `no space ${space}` }, { status: 400 });
    }
    return NextResponse.json(await spaceGraph(space));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 503 });
  }
}
