import { NextResponse } from 'next/server';
import { readLog } from '@/lib/plugins/log';

/** The plugin activity feed, from the id the caller last saw. */
export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get('since') ?? 0) || 0;
  return NextResponse.json(readLog(since));
}
