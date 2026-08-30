import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';

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

  return NextResponse.json({
    status,
    brief,
    selection,
    candidates: candidates?.candidates ?? [],
    script,
    gathered: Object.keys(evidence).length,
  });
}
