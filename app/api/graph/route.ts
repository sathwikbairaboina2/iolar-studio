import { NextResponse } from 'next/server';
import { chapterContext, searchTopics } from '@/lib/knowledge/spaces/handbooks';

/** Chapter context and topic search on the knowledge graph. The space views come next. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const subject = url.searchParams.get('subject');
  const chapter = url.searchParams.get('chapter');
  try {
    if (q) return NextResponse.json({ topics: await searchTopics(q) });
    if (subject && chapter) return NextResponse.json(await chapterContext(subject, chapter));
    return NextResponse.json({ nodes: [], edges: [] });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 503 });
  }
}
