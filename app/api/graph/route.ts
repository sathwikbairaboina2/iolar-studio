import { NextResponse } from 'next/server';
import { graph, postContext, searchTopics } from '@/lib/graph';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const slug = url.searchParams.get('slug');
  try {
    if (q) return NextResponse.json({ topics: searchTopics(q) });
    if (slug) return NextResponse.json(postContext(slug));
    return NextResponse.json(graph());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
