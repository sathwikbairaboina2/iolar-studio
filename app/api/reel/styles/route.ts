import { NextResponse } from 'next/server';
import { listStyles, loadStyle } from '@/lib/reel/styles';
import { isSlug } from '@/lib/paths';

/** Without `name`, the picker's list; with it, the full preset the studio player needs. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  if (!name) return NextResponse.json({ styles: await listStyles() });
  if (!isSlug(name)) return NextResponse.json({ error: 'bad style name' }, { status: 400 });
  try {
    return NextResponse.json({ style: await loadStyle(name) });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
