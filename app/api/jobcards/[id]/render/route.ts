import { NextResponse } from 'next/server';
import { FAMILIES, type Family } from '@/lib/jobcard/schema';
import { pickFamily } from '@/lib/jobcard/pick';
import { renderCard } from '@/lib/jobcard/render';
import { getRow, imagePath, readCard, recordRender } from '@/lib/jobcard/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The card as a PNG. A document still missing a mandatory field is not rendered — the
 * page is told what to ask for. A family that cannot hold the document is not shrunk to
 * fit it: campaign renders instead and the reply says so.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRow(id)) return NextResponse.json({ error: `no card ${id}` }, { status: 404 });

  const read = await readCard(id);
  if (!read) return NextResponse.json({ error: `no card ${id}` }, { status: 404 });
  if ('missing' in read) return NextResponse.json({ error: 'the document is not complete', missing: read.missing }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { family?: string };
  if (body.family && !(FAMILIES as readonly string[]).includes(body.family)) {
    return NextResponse.json({ error: `no family ${body.family}` }, { status: 400 });
  }
  const family = (body.family as Family | undefined) ?? pickFamily(read.card);

  const out = await renderCard(read.card, family, imagePath(id));
  recordRender(id, out);
  return NextResponse.json({ ...out, asked: family, row: getRow(id) });
}
