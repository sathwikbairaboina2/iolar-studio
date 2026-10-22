import { NextResponse } from 'next/server';
import { ANCHOR_PROMPT, listCandidates, lockAnchor, proposeAnchors, readAnchor } from '@/lib/launch/anchor';
import { HfUnreachable, realHf } from '@/lib/launch/higgsfield';

/** The channel's anchor: the locked face, the proposed candidates, and the two actions (propose four, lock one). */

export async function GET() {
  return NextResponse.json({ anchor: await readAnchor(), candidates: await listCandidates(), prompt: ANCHOR_PROMPT });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; jobId?: unknown; prompt?: unknown };
  if (body.action === 'propose') {
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 1200) : undefined;
    try {
      return NextResponse.json({ candidates: await proposeAnchors(await realHf(), prompt) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: err instanceof HfUnreachable ? 503 : 500 });
    }
  }
  if (body.action === 'lock') {
    if (typeof body.jobId !== 'string' || !body.jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    try {
      return NextResponse.json({ anchor: await lockAnchor(body.jobId) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
    }
  }
  return NextResponse.json({ error: 'action must be "propose" or "lock"' }, { status: 400 });
}
