import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { planFromTopic, planFromReferences } from '@/lib/ai/plan';
import { ClaudeUnavailableError } from '@/lib/ai/claude';
import { postDir } from '@/lib/store';

type Ctx = { params: Promise<{ slug: string }> };

export const maxDuration = 600;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = await req.json();
    if (body.mode === 'topic') {
      if (!body.topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 });
      return NextResponse.json(await planFromTopic(slug, body.topic.trim()));
    }
    if (body.mode === 'references') {
      let urls: string[] = body.urls ?? [];
      if (!urls.length) {
        try {
          urls = JSON.parse(await fs.readFile(path.join(postDir(slug), 'references.json'), 'utf8')).urls;
        } catch { /* none saved */ }
      }
      if (!urls.length) return NextResponse.json({ error: 'no reference urls' }, { status: 400 });
      return NextResponse.json(await planFromReferences(slug, urls));
    }
    return NextResponse.json({ error: 'mode must be topic or references' }, { status: 400 });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
