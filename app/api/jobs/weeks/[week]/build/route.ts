import { NextResponse } from 'next/server';
import { BoardDown, buildStatus } from '@/lib/jobs/board';

type Ctx = { params: Promise<{ week: string }> };

/** Where the board's detached build is, with its log tail. */
export async function GET(_req: Request, ctx: Ctx) {
  const { week } = await ctx.params;
  try {
    return NextResponse.json(await buildStatus(week));
  } catch (err) {
    const status = err instanceof BoardDown ? 503 : 400;
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
