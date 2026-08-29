import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadPost } from '@/lib/store';
import { partDir } from '@/lib/paths';
import { revisePost } from '@/lib/ai/revise';
import { diffPosts } from '@/lib/ai/diff';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export const maxDuration = 900;

function chatFile(subject: string, chapter: string, part: number) {
  return path.join(partDir(subject, chapter, part), 'chat.json');
}

async function appendChat(
  subject: string, chapter: string, part: number,
  entries: { role: string; text: string; ts: string }[]
) {
  const file = chatFile(subject, chapter, part);
  let history: unknown[] = [];
  try { history = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* fresh */ }
  await fs.writeFile(file, JSON.stringify([...history, ...entries], null, 2));
}

export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  try {
    return NextResponse.json({ history: JSON.parse(await fs.readFile(chatFile(subject, chapter, Number(part)), 'utf8')) });
  } catch {
    return NextResponse.json({ history: [] });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const { request, scope, slideIndex } = await req.json();
    if (typeof request !== 'string' || !request.trim()) {
      return NextResponse.json({ error: 'request text required' }, { status: 400 });
    }
    const post = await loadPost(subject, chapter, part);
    const proposal = await revisePost(post, request, scope ?? 'post', slideIndex);
    const diff = diffPosts(post, proposal);
    await appendChat(subject, chapter, part, [
      { role: 'user', text: request, ts: new Date().toISOString() },
      { role: 'assistant', text: `Proposed changes to ${diff.length} slide(s).`, ts: new Date().toISOString() },
    ]);
    // Does NOT save — the client applies the proposal through PUT after approval.
    return NextResponse.json({ proposal, diff });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
