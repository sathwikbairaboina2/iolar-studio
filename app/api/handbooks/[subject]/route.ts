import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { createChapter, listChapters, loadSubject } from '@/lib/store';
import { chapterDir, isSlug } from '@/lib/paths';
import { isCategoryId } from '@/lib/handbookCategories';

type Ctx = { params: Promise<{ subject: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { subject } = await ctx.params;
  try {
    return NextResponse.json({
      subject: await loadSubject(subject),
      chapters: await listChapters(subject),
    });
  } catch {
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { subject } = await ctx.params;
  try {
    const { slug, title, category } = await req.json();
    if (typeof slug !== 'string' || !isSlug(slug)) {
      return NextResponse.json({ error: 'slug must match [a-z0-9-]+' }, { status: 400 });
    }
    if (category !== undefined && !isCategoryId(category)) {
      return NextResponse.json({ error: `unknown category "${category}"` }, { status: 400 });
    }
    if (existsSync(chapterDir(subject, slug))) {
      return NextResponse.json({ error: 'chapter already exists' }, { status: 400 });
    }
    return NextResponse.json(await createChapter(subject, slug, title, category));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
