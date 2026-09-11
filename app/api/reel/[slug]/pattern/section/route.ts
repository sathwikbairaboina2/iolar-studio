import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { sectionReel } from '@/lib/reel/pattern/section';
import { patternState } from '@/lib/reel/pattern/run';
import { SectionError } from '@/lib/reel/pattern';
import { ServiceDown } from '@/lib/templates/service';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

/** Claude splits the approved script into sections; a rejected answer comes back with its path. */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  try {
    await sectionReel(slug);
    return NextResponse.json(await patternState(slug, { provider: null }));
  } catch (err) {
    if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    const msg = String(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: msg }, { status: /approved/.test(msg) ? 409 : 500 });
  }
}
