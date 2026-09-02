import { NextResponse } from 'next/server';
import { BoardDown, runStage, type StageName } from '@/lib/jobs/board';

type Ctx = { params: Promise<{ week: string }> };

/** Re-runs summarise or plan on the board. Voice, render and export are `npm run weekly` in a terminal. */
export async function POST(req: Request, ctx: Ctx) {
  const { week } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { stage?: string };
  try {
    const out = await runStage(week, body.stage as StageName);
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (err) {
    const status = err instanceof BoardDown ? 503 : 400;
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
