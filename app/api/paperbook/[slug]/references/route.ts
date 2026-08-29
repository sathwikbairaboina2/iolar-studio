import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { postDir } from '@/lib/store';

type Ctx = { params: Promise<{ slug: string }> };

function file(slug: string) {
  return path.join(postDir(slug), 'references.json');
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json(JSON.parse(await fs.readFile(file(slug), 'utf8')));
  } catch {
    return NextResponse.json({ urls: [] });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const { urls } = await req.json();
    if (!Array.isArray(urls) || urls.some((u) => typeof u !== 'string')) {
      return NextResponse.json({ error: 'urls must be a string array' }, { status: 400 });
    }
    const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    await fs.mkdir(postDir(slug), { recursive: true });
    await fs.writeFile(file(slug), JSON.stringify({ urls: clean }, null, 2));
    return NextResponse.json({ urls: clean });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
