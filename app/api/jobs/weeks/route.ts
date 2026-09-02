import { NextResponse } from 'next/server';
import { BoardDown, boardLinks, jobsReelBase, listWeeks } from '@/lib/jobs/board';

/** Every week the jobs-reel board knows, with the links back into it. */
export async function GET() {
  try {
    const base = jobsReelBase();
    const weeks = (await listWeeks()).map((w) => ({ ...w, links: boardLinks(w.week, base) }));
    // Weeks the graph has not seen at their current stage are indexed after the reply,
    // so the tab never waits on Neo4j and the graph is never more than one load behind.
    if ((await import('@/lib/knowledge')).knowledgeEnabled()) {
      void (async () => {
        const { indexedStage, recordWeek } = await import('@/lib/knowledge/spaces/jobs');
        const { readWeek } = await import('@/lib/jobs/board');
        for (const w of weeks) {
          if ((await indexedStage(w.week)) === w.stage) continue;
          await recordWeek(await readWeek(w.week));
        }
      })().catch(() => {});
    }
    return NextResponse.json({ weeks, board: base });
  } catch (err) {
    const down = err instanceof BoardDown;
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err), board: jobsReelBase() },
      { status: down ? 503 : 500 }
    );
  }
}
