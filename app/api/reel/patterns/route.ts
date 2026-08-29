import { NextResponse } from 'next/server';
import { listPatterns, loadPattern } from '@/lib/reel/patterns';
import { isSlug } from '@/lib/paths';

/** Without `name`, the picker's list; with it, the full preset the studio player needs. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  if (!name) return NextResponse.json({ patterns: await listPatterns() });
  if (!isSlug(name)) return NextResponse.json({ error: 'bad pattern name' }, { status: 400 });
  try {
    return NextResponse.json({ pattern: await loadPattern(name) });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
