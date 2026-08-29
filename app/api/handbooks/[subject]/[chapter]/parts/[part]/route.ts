import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { loadPost, savePost } from '@/lib/store';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  try {
    return NextResponse.json(await loadPost(subject, chapter, Number(part)));
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  try {
    await savePost(subject, chapter, Number(part), await req.json());
    return NextResponse.json(await loadPost(subject, chapter, Number(part)));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'validation failed', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
