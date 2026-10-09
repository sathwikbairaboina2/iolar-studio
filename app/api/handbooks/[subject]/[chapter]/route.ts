import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { listParts, loadChapterMeta } from '@/lib/store';
import { chapterFile } from '@/lib/paths';
import { isCategoryId } from '@/lib/handbookCategories';

type Ctx = { params: Promise<{ subject: string; chapter: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    return NextResponse.json({
      chapter: await loadChapterMeta(subject, chapter),
      parts: await listParts(subject, chapter),
    });
  } catch {
    return NextResponse.json({ error: 'chapter not found' }, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    const { title, category } = await req.json();
    // Either field may change alone; whatever is sent must be valid.
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }
    if (category !== undefined && !isCategoryId(category)) {
      return NextResponse.json({ error: `unknown category "${category}"` }, { status: 400 });
    }
    if (title === undefined && category === undefined) {
      return NextResponse.json({ error: 'title or category required' }, { status: 400 });
    }
    const current = JSON.parse(await fs.readFile(chapterFile(subject, chapter), 'utf8'));
    const next = { ...current, ...(title !== undefined ? { title } : {}), ...(category !== undefined ? { category } : {}) };
    await fs.writeFile(chapterFile(subject, chapter), JSON.stringify(next, null, 2));
    return NextResponse.json({ chapter: await loadChapterMeta(subject, chapter) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
