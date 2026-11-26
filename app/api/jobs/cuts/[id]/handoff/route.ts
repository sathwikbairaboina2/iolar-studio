import { NextResponse } from 'next/server';
import { handoffReel } from '@/lib/jobs/fromJobs';

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 300;

/**
 * Send the exported reel to IntaBot. 409 until the board has the export; IntaBot's own
 * refusal comes back with its status. The answer is IntaBot's `{ postId, accountId, caption, created }`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const contentId = text(b.contentId);
  if (!contentId) return NextResponse.json({ error: 'contentId is needed' }, { status: 400 });
  const out = await handoffReel(Number(id), {
    contentId,
    caption: text(b.caption),
    keyword: text(b.keyword),
    applyUrl: text(b.applyUrl),
    accountId: text(b.accountId),
  });
  const { status, ...body } = out;
  return NextResponse.json(body, { status });
}
