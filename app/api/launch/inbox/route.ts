import { NextResponse } from 'next/server';
import { listReferences, readWatchState } from '@/lib/launch/inbox';
import { maybeRunWatch } from '@/lib/launch/watch';

/** The references the daily watch found, and the state of the watch. Looking also starts today's check if it has not run. */
export async function GET() {
  void maybeRunWatch().catch((err) => console.error('[instastudio] launch watch failed', err));
  const [references, watch] = await Promise.all([listReferences(), readWatchState()]);
  return NextResponse.json({ references, watch });
}
