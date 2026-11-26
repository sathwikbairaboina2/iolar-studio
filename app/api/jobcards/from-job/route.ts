import { NextResponse } from 'next/server';
import { cardFromJob } from '@/lib/jobcard/fromJob';
import { PanelJobSchema } from '@/lib/jobcard/panelJob';
import { FAMILIES, type Family } from '@/lib/jobcard/schema';

/**
 * A card from a control-room job. The same job id always answers with the same card; it is
 * rendered again only when the job changed, or another family is asked for. A job with gaps
 * is stored as a draft and answered 422 with the gaps named, so the panel can show them.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { job?: unknown; family?: string; render?: boolean };
  const job = PanelJobSchema.safeParse(body.job);
  if (!job.success) {
    return NextResponse.json({ error: 'a job in the panel\'s shape is needed', issues: job.error.issues.map((i) => `${i.path.join('.') || 'job'}: ${i.message}`) }, { status: 400 });
  }
  if (body.family !== undefined && !(FAMILIES as readonly string[]).includes(body.family)) {
    return NextResponse.json({ error: `no family ${body.family}` }, { status: 400 });
  }

  const render = body.render !== false;
  const out = await cardFromJob(job.data, { origin: new URL(req.url).origin, family: body.family as Family | undefined, render });
  if (render && out.missing.length) {
    return NextResponse.json({ error: 'the job is not complete', cardId: out.cardId, missing: out.missing }, { status: 422 });
  }
  const { panelJobId: _p, ...rest } = out;
  return NextResponse.json(rest);
}
