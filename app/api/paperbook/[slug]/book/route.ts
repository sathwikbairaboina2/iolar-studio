import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadBook, saveBook, reviseBook } from '@/lib/ai/book';
import { planBook } from '@/lib/ai/plan';
import { ClaudeUnavailableError } from '@/lib/ai/claude';
import { postDir } from '@/lib/store';

type Ctx = { params: Promise<{ slug: string }> };

export const maxDuration = 900;

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return NextResponse.json({ book: await loadBook(slug) });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ book: await saveBook(slug, await req.json()) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = await req.json();

    if (body.action === 'revise') {
      const book = await loadBook(slug);
      if (!book) return NextResponse.json({ error: 'no book yet' }, { status: 400 });
      if (!body.request?.trim()) return NextResponse.json({ error: 'request required' }, { status: 400 });
      // Proposal only — saved when the user approves.
      return NextResponse.json({ proposal: await reviseBook(slug, book, body.request.trim()) });
    }

    if (body.action === 'generate') {
      if (body.mode === 'topic') {
        if (!body.topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 });
        return NextResponse.json({ book: await planBook(slug, 'topic', body.topic.trim()) });
      }
      let urls: string[] = body.urls ?? [];
      if (!urls.length) {
        try {
          urls = JSON.parse(await fs.readFile(path.join(postDir(slug), 'references.json'), 'utf8')).urls;
        } catch { /* none saved */ }
      }
      if (!urls.length) return NextResponse.json({ error: 'no reference urls' }, { status: 400 });
      return NextResponse.json({ book: await planBook(slug, 'references', urls) });
    }

    return NextResponse.json({ error: 'action must be generate or revise' }, { status: 400 });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
