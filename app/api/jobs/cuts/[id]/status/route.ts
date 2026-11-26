import { NextResponse } from 'next/server';
import { BoardDown } from '@/lib/jobs/board';
import { cutStatus } from '@/lib/jobs/fromJobs';

type Ctx = { params: Promise<{ id: string }> };

/** Where a reel cut from jobs is: planning, voicing, building, exported (with the video url) or failed (with why). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return NextResponse.json({ error: `no cut ${id}` }, { status: 404 });
  try {
    const status = await cutStatus(n);
    if (!status) return NextResponse.json({ error: `no jobs reel cut ${id}` }, { status: 404 });
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof BoardDown) return NextResponse.json({ error: 'jobs-reel plugin is not running' }, { status: 503 });
    throw err;
  }
}
