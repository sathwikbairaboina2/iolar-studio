import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';
import { readTrace } from '@/lib/reel/research/trace';

type Ctx = { params: Promise<{ slug: string }> };

/** Everything the research panel needs to draw itself, including where it stopped. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const status = await store.researchStatus(slug);
  if (!status) return NextResponse.json({ status: null });

  const [brief, selection] = await Promise.all([store.readBrief(slug), store.readSelection(slug)]);
  const candidates = await store.readCandidates(slug).catch(() => null);
  const script = await store.readScript(slug).catch(() => null);
  const evidence = await store.readAllEvidence(slug);
  const plan = await store.readPlan(slug);
  const trace = await readTrace(slug);

  return NextResponse.json({
    status,
    brief,
    plan,
    trace,
    selection,
    candidates: candidates?.candidates ?? [],
    script,
    gathered: Object.keys(evidence).length,
  });
}
