import { NextResponse } from 'next/server';
import { loadBook } from '@/lib/ai/book';
import { locateSection } from '@/lib/ai/fit';
import { listParts, loadPost } from '@/lib/store';

type Ctx = { params: Promise<{ subject: string; chapter: string }> };

/** Where a book section is taught: `?section=N` → `{ part, page }`, or nulls when it cannot be placed. */
export async function GET(req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  const section = Number(new URL(req.url).searchParams.get('section'));
  const book = await loadBook(subject, chapter);
  if (!book || !Number.isInteger(section)) return NextResponse.json({ part: null, page: null });
  try {
    const parts = await Promise.all(
      (await listParts(subject, chapter)).map(async (part) => ({ part, post: await loadPost(subject, chapter, part) }))
    );
    return NextResponse.json(locateSection(book, section, parts) ?? { part: null, page: null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
