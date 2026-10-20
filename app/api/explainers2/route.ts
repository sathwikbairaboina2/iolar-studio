import { NextResponse } from 'next/server';
import { BriefSchema } from '@/lib/explainer2/schema';
import { createExplainer, listExplainers } from '@/lib/explainer2/store';
import { startRun } from '@/lib/explainer2/start';

/** The designed explainers: a list read off disk, and the one way onto it (a brief). */

export async function GET() {
  return NextResponse.json({ explainers: await listExplainers() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const brief = BriefSchema.safeParse(body);
  if (!brief.success) {
    return NextResponse.json({ error: brief.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  const slug = await createExplainer(brief.data);
  // Starting is optional so a brief can be saved and run later; the usual path starts it.
  if (body.start === true) await startRun(slug).catch((err) => console.error('[instastudio] explainer2 start failed', err));
  return NextResponse.json({ slug }, { status: 201 });
}
