import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { loadPost, savePost } from '@/lib/store';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    return NextResponse.json(await loadPost(slug));
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = await req.json();
    await savePost(slug, body);
    return NextResponse.json(await loadPost(slug));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'validation failed', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
