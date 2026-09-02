import { NextResponse } from 'next/server';
import { cutView } from '@/lib/jobs/cut';

type Ctx = { params: Promise<{ id: string }> };

/** One cut: its tiles, its brief, every mapped row and reject, and every submission. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const view = await cutView(Number(id));
  if (!view) return NextResponse.json({ error: `no cut ${id}` }, { status: 404 });
  return NextResponse.json(view);
}
