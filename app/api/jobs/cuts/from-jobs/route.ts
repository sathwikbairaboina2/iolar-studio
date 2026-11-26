import { NextResponse } from 'next/server';
import { BoardNotRunning, NothingToCut, startCutFromJobs } from '@/lib/jobs/fromJobs';
import { PanelJobSchema, type PanelJob } from '@/lib/jobcard/panelJob';
import { logPlugin } from '@/lib/plugins/log';

/**
 * A jobs reel from exactly the jobs the panel names. The cut is made and the submit to the
 * board is started in the background (the script alone takes about a minute); the answer is
 * the cut id and where the board shows it, and `GET /api/jobs/cuts/<id>/status` follows it.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { contentId?: unknown; title?: unknown; jobs?: unknown; style?: unknown; voice?: unknown };
  const contentId = typeof b.contentId === 'string' ? b.contentId.trim() : '';
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!contentId || !title) return NextResponse.json({ error: 'contentId and title are needed' }, { status: 400 });
  if (!Array.isArray(b.jobs) || b.jobs.length < 1) return NextResponse.json({ error: 'at least one job is needed' }, { status: 400 });
  const jobs: PanelJob[] = [];
  for (const [i, j] of b.jobs.entries()) {
    const parsed = PanelJobSchema.safeParse(j);
    if (!parsed.success) return NextResponse.json({ error: `jobs[${i}] is not a job in the panel's shape` }, { status: 400 });
    jobs.push(parsed.data);
  }
  const voice = b.voice === 'own' || b.voice === 'studio' || b.voice === 'plugin' ? b.voice : undefined;

  try {
    const started = await startCutFromJobs(
      { contentId, title, jobs },
      { voice, style: typeof b.style === 'string' ? b.style : undefined }
    );
    void started.done.then(() => {
      const cut = started.cut;
      logPlugin('jobsreel', `reel cut ${cut.periodKey} for ${contentId} submitted to the board`, 'success');
    });
    return NextResponse.json({ cutId: started.cut.id, boardUrl: started.boardUrl, status: 'planning' }, { status: 202 });
  } catch (err) {
    if (err instanceof BoardNotRunning) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof NothingToCut) return NextResponse.json({ error: err.message, reasons: err.reasons }, { status: 422 });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
