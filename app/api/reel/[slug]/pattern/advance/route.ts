import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { advancePattern } from '@/lib/reel/pattern/run';
import { SectionError } from '@/lib/reel/pattern';
import { ServiceDown, ServiceRejected } from '@/lib/templates/service';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

/** One stage forward; the voice fork is the only choice. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { voice?: 'tts' | 'supplied' };
  try {
    return NextResponse.json(await advancePattern(slug, { voice: body.voice === 'tts' ? 'tts' : 'supplied' }));
  } catch (err) {
    if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
    if (err instanceof ServiceRejected) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
