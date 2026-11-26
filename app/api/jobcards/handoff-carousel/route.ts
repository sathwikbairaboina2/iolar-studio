import { NextResponse } from 'next/server';
import { handoffCarousel } from '@/lib/jobcard/handoff';

/**
 * Send rendered cards to IntaBot as one carousel, in the order given. IntaBot's answer
 * comes back as it is: `{ postId, accountId, caption, created }`, with `created` false when
 * the content id was already handed over.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const contentId = text(b.contentId);
  const title = text(b.title);
  const cardIds = Array.isArray(b.cardIds) && b.cardIds.every((x) => typeof x === 'string') ? (b.cardIds as string[]) : null;
  if (!contentId || !title || !cardIds) {
    return NextResponse.json({ error: 'contentId, title and cardIds are needed' }, { status: 400 });
  }
  const out = await handoffCarousel({
    contentId,
    title,
    cardIds,
    caption: text(b.caption),
    keyword: text(b.keyword),
    applyUrl: text(b.applyUrl),
    accountId: text(b.accountId),
  });
  const { status, ...body } = out;
  return NextResponse.json(body, { status });
}
