import { NextResponse } from 'next/server';
import * as ledger from '@/lib/jobs/ledger';
import { clearOwnVoice, readOwnVoice, saveOwnVoice } from '@/lib/jobs/ownVoice';

type Ctx = { params: Promise<{ id: string }> };

/** The recording the user dropped on this cut, if any. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cut = ledger.getCut(Number(id));
  if (!cut) return NextResponse.json({ error: `no cut ${id}` }, { status: 404 });
  const v = readOwnVoice(cut.periodKey);
  return NextResponse.json({ ownVoice: v ? { format: v.format, bytes: v.bytes, name: v.name, at: v.at } : null });
}

/**
 * Takes the user's own recording of the whole reel, optional. Raw bytes; the name comes
 * from `?name=` (its extension says the format). Submit sends it to the board instead of
 * reading the lines with the studio's voice.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cut = ledger.getCut(Number(id));
  if (!cut) return NextResponse.json({ error: `no cut ${id}` }, { status: 404 });
  const name = new URL(req.url).searchParams.get('name') ?? '';
  if (!name) return NextResponse.json({ error: 'say the file name: ?name=take.m4a' }, { status: 400 });
  const bytes = Buffer.from(await req.arrayBuffer());
  try {
    const meta = saveOwnVoice(cut.periodKey, bytes, name);
    return NextResponse.json({ ok: true, ownVoice: meta });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: msg }, { status: msg.includes('too large') ? 413 : 400 });
  }
}

/** Forget the recording; the next submit reads the lines with the studio's voice again. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cut = ledger.getCut(Number(id));
  if (!cut) return NextResponse.json({ error: `no cut ${id}` }, { status: 404 });
  return NextResponse.json({ ok: true, cleared: clearOwnVoice(cut.periodKey) });
}
