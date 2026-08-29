import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { chapterDir, referencesFile } from '@/lib/paths';

type Ctx = { params: Promise<{ subject: string; chapter: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    return NextResponse.json(JSON.parse(await fs.readFile(referencesFile(subject, chapter), 'utf8')));
  } catch {
    return NextResponse.json({ urls: [] });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    const { urls } = await req.json();
    if (!Array.isArray(urls) || urls.some((u) => typeof u !== 'string')) {
      return NextResponse.json({ error: 'urls must be a string array' }, { status: 400 });
    }
    const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    await fs.mkdir(chapterDir(subject, chapter), { recursive: true });
    await fs.writeFile(referencesFile(subject, chapter), JSON.stringify({ urls: clean }, null, 2));
    try {
      const { syncReferences } = await import('@/lib/graph');
      syncReferences(subject, chapter, clean);
    } catch (err) {
      console.warn('[instastudio] reference index failed', err);
    }
    return NextResponse.json({ urls: clean });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
