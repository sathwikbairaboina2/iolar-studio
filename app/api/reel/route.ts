import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { createReel, listReels } from '@/lib/reel/store';
import { reelDir, slugify } from '@/lib/paths';
import { getSettings } from '@/lib/settings';

export async function GET() {
  return NextResponse.json({ reels: await listReels() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const title: string = body.title ?? '';
    const slug: string = slugify(body.slug ? String(body.slug) : title);
    if (!slug) return NextResponse.json({ error: 'title or slug required' }, { status: 400 });

    const exists = await fs.access(reelDir(slug)).then(() => true).catch(() => false);
    if (exists) return NextResponse.json({ error: `reel ${slug} already exists` }, { status: 409 });

    const s = getSettings();
    const reel = await createReel(slug, {
      title: title || slug,
      style: body.style ?? s.reelStyle,
      fps: s.reelFps,
      ratio: (body.ratio ?? s.reelRatio) as '9:16' | '4:5' | '1:1',
    });
    return NextResponse.json({ slug, reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
