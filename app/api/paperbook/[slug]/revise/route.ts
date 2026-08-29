import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadPost, postDir } from '@/lib/store';
import { revisePost } from '@/lib/ai/revise';
import { diffPosts } from '@/lib/ai/diff';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ slug: string }> };

async function appendChat(slug: string, entries: { role: string; text: string; ts: string }[]) {
  const file = path.join(postDir(slug), 'chat.json');
  let history: unknown[] = [];
  try { history = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* fresh */ }
  await fs.writeFile(file, JSON.stringify([...history, ...entries], null, 2));
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const raw = await fs.readFile(path.join(postDir(slug), 'chat.json'), 'utf8');
    return NextResponse.json({ history: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ history: [] });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const { request, scope, slideIndex } = await req.json();
    if (typeof request !== 'string' || !request.trim()) {
      return NextResponse.json({ error: 'request text required' }, { status: 400 });
    }
    const post = await loadPost(slug);
    const proposal = await revisePost(post, request, scope ?? 'post', slideIndex);
    const diff = diffPosts(post, proposal);
    await appendChat(slug, [
      { role: 'user', text: request, ts: new Date().toISOString() },
      { role: 'assistant', text: `Proposed changes to ${diff.length} slide(s).`, ts: new Date().toISOString() },
    ]);
    // Does NOT save — the client applies the proposal through PUT after approval.
    return NextResponse.json({ proposal, diff });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const msg = String(err);
    const status = msg.includes('max 10') || msg.includes('validation') ? 422 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
