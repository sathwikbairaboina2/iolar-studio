import { NextResponse } from 'next/server';
import { cardsFromJobs } from '@/lib/jobcard/fromJob';
import { PanelJobSchema, type PanelJob } from '@/lib/jobcard/panelJob';

/**
 * One card per job for a carousel, rendered one after another. Each entry says how its own
 * job went (a gap, or a render that failed), so one bad job never fails the rest.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { jobs?: unknown; render?: boolean };
  if (!Array.isArray(body.jobs) || body.jobs.length < 2 || body.jobs.length > 10) {
    return NextResponse.json({ error: `a carousel takes 2-10 jobs, got ${Array.isArray(body.jobs) ? body.jobs.length : 0}` }, { status: 400 });
  }
  const jobs: PanelJob[] = [];
  for (const [i, j] of body.jobs.entries()) {
    const parsed = PanelJobSchema.safeParse(j);
    if (!parsed.success) return NextResponse.json({ error: `jobs[${i}] is not a job in the panel's shape` }, { status: 400 });
    jobs.push(parsed.data);
  }
  const cards = await cardsFromJobs(jobs, { origin: new URL(req.url).origin, render: body.render !== false });
  return NextResponse.json({ cards });
}
