import { NextResponse } from 'next/server';
import { graph, chapterContext, searchTopics } from '@/lib/graph';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const subject = url.searchParams.get('subject');
  const chapter = url.searchParams.get('chapter');
  try {
    if (q) return NextResponse.json({ topics: searchTopics(q) });
    if (subject && chapter) return NextResponse.json(chapterContext(subject, chapter));
    return NextResponse.json(graph());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
