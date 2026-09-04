import { NextResponse } from 'next/server';
import { missingMandatory, parseJobCard, type JobCardDraft } from '@/lib/jobcard/schema';
import { scoreFamilies } from '@/lib/jobcard/pick';
import { getRow, readDraft, saveCard } from '@/lib/jobcard/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * One card's document: what it says, what it is still missing, and — once nothing is
 * missing — which family it wants, every family ranked so the answer can be overridden.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = getRow(id);
  const draft = await readDraft(id);
  if (!row || !draft) return NextResponse.json({ error: `no card ${id}` }, { status: 404 });

  const missing = missingMandatory(draft);
  let families: ReturnType<typeof scoreFamilies> = [];
  if (!missing.length) {
    try {
      families = scoreFamilies(parseJobCard(draft));
    } catch {
      families = [];
    }
  }
  return NextResponse.json({ row, draft, missing, families });
}

/** A corrected document. What the user typed is what is stored; nothing is filled in behind them. */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRow(id)) return NextResponse.json({ error: `no card ${id}` }, { status: 404 });

  const draft = (await req.json().catch(() => null)) as JobCardDraft | null;
  if (!draft || typeof draft !== 'object') return NextResponse.json({ error: 'a document is needed' }, { status: 400 });

  const row = await saveCard(id, draft);
  return NextResponse.json({ row, draft, missing: missingMandatory(draft) });
}
