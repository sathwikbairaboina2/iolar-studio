import { NextResponse } from 'next/server';
import { adoptFromInbox, openInbox } from '@/lib/reel/inbox';

type Ctx = { params: Promise<{ slug: string }> };

/** What is sitting in each beat's folder, and where that folder is. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ inbox: await openInbox(slug) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}

/** Adopts one file from a beat's folder as that beat's footage. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const role = body.role === 'shot' ? 'shot' : 'still';
    const reel = await adoptFromInbox(slug, String(body.beatId ?? ''), String(body.name ?? ''), role);
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
