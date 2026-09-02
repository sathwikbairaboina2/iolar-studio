import { NextResponse } from 'next/server';
import { BoardDown, weekRequest } from '@/lib/jobs/board';

type Ctx = { params: Promise<{ week: string }> };

/** The concrete request for a submitted week in one style. */
export async function GET(req: Request, ctx: Ctx) {
  const { week } = await ctx.params;
  const style = new URL(req.url).searchParams.get('style') ?? '';
  try {
    return NextResponse.json(await weekRequest(week, style));
  } catch (err) {
    const status = err instanceof BoardDown ? 503 : 400;
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
