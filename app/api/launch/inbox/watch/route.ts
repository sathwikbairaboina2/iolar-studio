import { NextResponse } from 'next/server';
import { realWatchDeps, runWatch, watchRunning } from '@/lib/launch/watch';

/** "Check now": starts the watch at once and returns; its state is read back from GET /api/launch/inbox. */
export async function POST() {
  if (await watchRunning()) return NextResponse.json({ error: 'a check is already running' }, { status: 409 });
  void realWatchDeps().then(runWatch).catch((err) => console.error('[instastudio] launch watch failed', err));
  return NextResponse.json({ started: true }, { status: 202 });
}
