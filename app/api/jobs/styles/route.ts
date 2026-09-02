import { NextResponse } from 'next/server';
import { BoardDown, listStyles, jobsReelBase } from '@/lib/jobs/board';

/** The style packs and the request each expects, straight from the board. */
export async function GET() {
  try {
    return NextResponse.json({ board: jobsReelBase(), styles: await listStyles() });
  } catch (err) {
    const status = err instanceof BoardDown ? 503 : 400;
    return NextResponse.json({ board: jobsReelBase(), styles: [], error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
