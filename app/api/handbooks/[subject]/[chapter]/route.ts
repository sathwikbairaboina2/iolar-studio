import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { listParts, loadChapterMeta } from '@/lib/store';
import { chapterFile } from '@/lib/paths';

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
    const { title } = await req.json();
    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }
    const current = JSON.parse(await fs.readFile(chapterFile(subject, chapter), 'utf8'));
    await fs.writeFile(chapterFile(subject, chapter), JSON.stringify({ ...current, title }, null, 2));
    return NextResponse.json({ chapter: await loadChapterMeta(subject, chapter) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
