import { NextResponse } from 'next/server';
import { submitCut, CutNotSubmittable } from '@/lib/jobs/submit';
import { logPlugin } from '@/lib/plugins/log';

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 300;

/** Post the cut to the board, then summarise and plan there. Every reply lands in the ledger. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; style?: string; voice?: 'own' | 'studio' | 'plugin' };
  try {
    const out = await submitCut(Number(id), {
      force: body.force === true, style: typeof body.style === 'string' ? body.style : undefined, voice: body.voice,
      record: async (cut, pullId) => (await import('@/lib/knowledge/spaces/jobs')).recordCut(cut, pullId),
    });
    const last = out.submissions.at(-1);
    logPlugin(
      'jobsreel',
      out.cut.status === 'failed'
        ? `cut ${out.cut.periodKey} failed at ${last?.stage ?? 'submit'}: ${last?.error ?? 'unknown'}`
        : `cut ${out.cut.periodKey} is ${out.cut.status} on the board (${out.cut.counted} rows)`,
      out.cut.status === 'failed' ? 'error' : 'success'
    );
    return NextResponse.json(out, { status: out.cut.status === 'failed' ? 502 : 200 });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: msg }, { status: err instanceof CutNotSubmittable ? 409 : 500 });
  }
}
