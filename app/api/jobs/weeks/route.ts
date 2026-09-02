import { NextResponse } from 'next/server';
import { BoardDown, boardLinks, jobsReelBase, listWeeks } from '@/lib/jobs/board';

/** Every week the jobs-reel board knows, with the links back into it. */
export async function GET() {
  try {
    const base = jobsReelBase();
    const weeks = (await listWeeks()).map((w) => ({ ...w, links: boardLinks(w.week, base) }));
    return NextResponse.json({ weeks, board: base });
  } catch (err) {
    const down = err instanceof BoardDown;
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err), board: jobsReelBase() },
      { status: down ? 503 : 500 }
    );
  }
}
