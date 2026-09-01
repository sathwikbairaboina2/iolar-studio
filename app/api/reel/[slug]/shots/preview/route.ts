import { NextResponse } from 'next/server';
import { previewShots } from '@/lib/reel/shots';
// Registers the renderers, so the preview can tell a missing plugin from a wired one.
import '@/lib/reel/providers';

type Ctx = { params: Promise<{ slug: string }> };

/** What the renderers would be sent, before a single job is queued. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ shots: await previewShots(slug) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
