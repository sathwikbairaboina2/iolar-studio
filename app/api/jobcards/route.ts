import { NextResponse } from 'next/server';
import { thinker } from '@/lib/ai/runner';
import { poolRowById } from '@/lib/jobs/ledger';
import type { ResearchJob } from '@/lib/jobs/researchApi';
import { fromPoolRow, fromUrl, marksForUrl, type Runner } from '@/lib/jobcard/extract';
import { isUsableMark, searxngSearch, type FoundMark } from '@/lib/jobcard/logo';
import { getSettings } from '@/lib/settings';
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
    return thinker();
  } catch {
    return undefined;
  }
};

/**
 * The candidates are tried in order and the first that is actually a mark is kept: square
 * enough for a tile, big enough to set. A social banner or a sixteen-pixel favicon is
 * skipped rather than stretched, and running out of candidates leaves a wordmark, which is
 * a real fallback and not a placeholder.
 */
async function pullLogo(id: string, marks: FoundMark[]): Promise<{ src: string; kind: 'page' | 'search' } | null> {
  for (const mark of marks.slice(0, 6)) {
    try {
      const r = await fetch(mark.url, { headers: { 'user-agent': 'iolar-jobcard/1.0' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!(await isUsableMark(bytes))) continue;
      const type = r.headers.get('content-type') ?? '';
      const ext = /svg/.test(type) ? 'svg' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : 'png';
      const src = await saveLogo(id, bytes, ext);
      // A mark on the listing's own page is one the page published; anything reached by
      // following a link or a search is a find, and the document says which it was.
      return { src, kind: mark.from === 'markup' || mark.from === 'job-page' ? 'page' : 'search' };
    } catch {
      // Try the next candidate; a mark that will not download is not a mark.
    }
  }
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    poolId?: number;
    draft?: JobCardDraft;
    useModel?: boolean;
  };
  const run = body.useModel === false ? undefined : runner();
  const search = searxngSearch(getSettings().searxngUrl);

  let draft: JobCardDraft;
  let marks: FoundMark[] = [];

  if (body.draft) {
    draft = body.draft;
  } else if (typeof body.poolId === 'number') {
    const row = poolRowById(body.poolId);
    if (!row) return NextResponse.json({ error: `no pool row ${body.poolId}` }, { status: 404 });
    const job = row.raw as unknown as ResearchJob;
    draft = await fromPoolRow(job, run);
    // The row says where the listing lives; the mark is looked for there.
    marks = job.url ? await marksForUrl(job.url, { company: job.company, search }) : [];
  } else if (body.url) {
    try {
      const read = await fromUrl(body.url, { run, search });
      draft = read.draft;
      marks = read.marks;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: 'a job URL, a pool row or a draft is needed' }, { status: 400 });
  }

  const id = cardId(draft);
  const logo = await pullLogo(id, marks);
  if (logo && draft.company) draft = { ...draft, company: { ...draft.company, logo, accent: draft.company.accent ?? null } };

  const row = await saveCard(id, draft);
  return NextResponse.json({ id, row, draft, missing: missingMandatory(draft) }, { status: 201 });
}
