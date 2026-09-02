import { NextResponse } from 'next/server';
import { BoardDown, runStage, type StageName } from '@/lib/jobs/board';

type Ctx = { params: Promise<{ week: string }> };

/** Runs one of the board's stages: summarise, plan (with a style), script, or build. */
export async function POST(req: Request, ctx: Ctx) {
  const { week } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { stage?: string; style?: string };
  try {
    const out = await runStage(week, body.stage as StageName, { style: typeof body.style === 'string' ? body.style : undefined });
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (err) {
    const status = err instanceof BoardDown ? 503 : 400;
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
