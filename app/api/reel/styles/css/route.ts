import { NextResponse } from 'next/server';
import { styleCss } from '@/lib/reel/styles';
import { isSlug } from '@/lib/paths';

/** Serves a style's caption.css to the studio, so the preview is styled by the same
 *  stylesheet the export's Playwright pass loads. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name') ?? '';
  if (!isSlug(name)) return NextResponse.json({ error: 'bad style name' }, { status: 400 });
  try {
    return new NextResponse(await styleCss(name), {
      headers: { 'content-type': 'text/css', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
