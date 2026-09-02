import { NextResponse } from 'next/server';
import * as ledger from '@/lib/jobs/ledger';
import { prepareCut } from '@/lib/jobs/cut';
import { logPlugin } from '@/lib/plugins/log';

export const maxDuration = 300;

/** The ledger of cuts, newest period first. */
export async function GET() {
  return NextResponse.json({ cuts: ledger.listCuts() });
}

/** Prepare a cut for this week or today, or a named period. Thin cuts are stored, not refused. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; periodKey?: string; force?: boolean };
  const kind = body.kind === 'daily' ? 'daily' : 'weekly';
  try {
    const cut = await prepareCut(kind, body.periodKey, { force: body.force === true });
    logPlugin(
      'jobsreel',
      `${cut.status === 'thin' ? 'thin cut' : 'cut'} ${cut.periodKey}: ${cut.counted} rows, ${cut.rejected} rejected`,
      cut.status === 'thin' ? 'warning' : 'success'
    );
    return NextResponse.json({ cut });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const locked = err instanceof ledger.CutLocked;
    return NextResponse.json({ error: msg }, { status: locked ? 409 : 400 });
  }
}
