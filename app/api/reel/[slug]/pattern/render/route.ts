import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { renderPattern } from '@/lib/reel/pattern/run';
import { ServiceDown, ServiceRejected } from '@/lib/reel/pattern/service';

type Ctx = { params: Promise<{ slug: string }> };

/** Validate, submit, remember the job — from any stage past presented, so a re-render is one click. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { captions?: boolean };
  try {
    return NextResponse.json(await renderPattern(slug, { captions: body.captions !== false }));
  } catch (err) {
    if (err instanceof ServiceRejected) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
