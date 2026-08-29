import { NextResponse } from 'next/server';
import { clonePattern } from '@/lib/reel/clone';

export const maxDuration = 900;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mediaUrl = String(body.mediaUrl ?? '');
  if (!/^https?:\/\//.test(mediaUrl)) {
    return NextResponse.json({ error: 'mediaUrl required' }, { status: 400 });
  }
  try {
    const out = await clonePattern(mediaUrl, body.name ? String(body.name) : undefined);
    return NextResponse.json({ name: out.name, pattern: out.pattern, report: out.report });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
