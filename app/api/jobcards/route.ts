import { NextResponse } from 'next/server';
import { qwenRunner } from '@/lib/ai/qwen';
import { poolRowById } from '@/lib/jobs/ledger';
import type { ResearchJob } from '@/lib/jobs/researchApi';
import { fromPoolRow, fromUrl, type Runner } from '@/lib/jobcard/extract';
import { cardId, listRows, saveCard, saveLogo } from '@/lib/jobcard/store';
import { missingMandatory, type JobCardDraft } from '@/lib/jobcard/schema';

/**
 * The two ways into a card. A URL is fetched and read; a pool row is mapped across.
 * Either way the answer is a document with its gaps named, never a card with a hole
 * in it. The model is asked for what only prose says, and a model that is down costs
 * eligibility and the rounds, not the whole card.
 */

export async function GET() {
  return NextResponse.json({ cards: listRows() });
}

const runner = (): Runner | undefined => {
  try {
    return qwenRunner();
  } catch {
    return undefined;
  }
};

/** A mark is downloaded once, beside the document; a fetch that fails leaves a wordmark. */
async function pullLogo(id: string, url: string | null): Promise<{ src: string; kind: 'page' } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'iolar-jobcard/1.0' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    const ext = /svg/.test(type) ? 'svg' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : 'png';
    const src = await saveLogo(id, new Uint8Array(await r.arrayBuffer()), ext);
    return { src, kind: 'page' };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    poolId?: number;
    draft?: JobCardDraft;
    useModel?: boolean;
  };
  const run = body.useModel === false ? undefined : runner();

  let draft: JobCardDraft;
  let logoUrl: string | null = null;

  if (body.draft) {
    draft = body.draft;
  } else if (typeof body.poolId === 'number') {
    const row = poolRowById(body.poolId);
    if (!row) return NextResponse.json({ error: `no pool row ${body.poolId}` }, { status: 404 });
    draft = await fromPoolRow(row.raw as unknown as ResearchJob, run);
  } else if (body.url) {
    try {
      const read = await fromUrl(body.url, { run });
      draft = read.draft;
      logoUrl = read.logoUrl;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: 'a job URL, a pool row or a draft is needed' }, { status: 400 });
  }

  const id = cardId(draft);
  const logo = await pullLogo(id, logoUrl);
  if (logo && draft.company) draft = { ...draft, company: { ...draft.company, logo, accent: draft.company.accent ?? null } };

  const row = await saveCard(id, draft);
  return NextResponse.json({ id, row, draft, missing: missingMandatory(draft) }, { status: 201 });
}
