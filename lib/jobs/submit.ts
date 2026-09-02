import * as ledger from './ledger';
import { runStage, submitJobs, type BoardOpts, BoardDown } from './board';
import type { RejectedRow, ReelJob } from './reelSchema';

/**
 * Submit: post a prepared cut to the jobs-reel board as its jobs.json, then run the two
 * stages the board offers, recording every reply. A thin cut is refused before any call
 * unless forced. The cut's status follows the board: submitted, summarised, planned, or
 * failed with the message in the last submission.
 */

export class CutNotSubmittable extends Error {}

export type SubmitOpts = BoardOpts & { force?: boolean; now?: Date; record?: (cut: ledger.Cut, pullId: number | null) => Promise<void> };

export async function submitCut(id: number, opts: SubmitOpts = {}): Promise<{ cut: ledger.Cut; submissions: ledger.Submission[] }> {
  const cut = ledger.getCut(id);
  if (!cut) throw new CutNotSubmittable(`no cut ${id}`);
  if (cut.status === 'thin' && !opts.force) {
    throw new CutNotSubmittable(`cut ${cut.periodKey} is thin (${cut.counted} rows); submit with force to send it anyway`);
  }
  const now = (opts.now ?? new Date()).toISOString();
  const rows = ledger.cutRows(id);
  const jobs = rows.filter((r) => r.row).map((r) => r.row as unknown as ReelJob);
  const rejected: RejectedRow[] = rows
    .filter((r) => !r.row)
    .map((r, i) => ({ row: i + 1, why: r.rejectReason ?? 'rejected', raw: { researchId: String(r.researchId) } }));
  const pull = ledger.lastPull();

  const body = {
    importedAt: now,
    source: { kind: 'studio', cutId: cut.id, pulledAt: pull?.at ?? now },
    jobs,
    rejected,
    warnings: cut.status === 'thin' ? [`thin cut: ${cut.counted} rows`] : [],
    brief: cut.briefMd ?? undefined,
    force: opts.force === true,
  };

  const record = (accepted: number, stage: string | null, reply: unknown, error: string | null) =>
    ledger.addSubmission({ cutId: id, at: new Date().toISOString(), accepted, rejected: rejected.length, stage, reply, error });

  // 1. the list
  let reply;
  try {
    reply = await submitJobs(cut.periodKey, body, opts);
  } catch (err) {
    const msg = err instanceof BoardDown ? err.message : String(err instanceof Error ? err.message : err);
    record(0, null, null, msg);
    ledger.setCutStatus(id, 'failed');
    return done(id);
  }
  if (!reply.ok) {
    record(0, null, reply, reply.message ?? `the board answered ${reply.status}`);
    ledger.setCutStatus(id, 'failed');
    return done(id);
  }
  record(reply.counted ?? jobs.length, 'imported', reply, null);
  ledger.setCutStatus(id, 'submitted');

  // 2. summarise, 3. plan — the board's own functions, one call each
  for (const [stage, status] of [
    ['summarise', 'summarised'],
    ['plan', 'planned'],
  ] as const) {
    let out;
    try {
      out = await runStage(cut.periodKey, stage, opts);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      record(jobs.length, stage, null, msg);
      ledger.setCutStatus(id, 'failed');
      return done(id);
    }
    if (!out.ok) {
      record(jobs.length, stage, out, out.message ?? `${stage} refused`);
      ledger.setCutStatus(id, 'failed');
      return done(id);
    }
    record(jobs.length, stage, out, null);
    ledger.setCutStatus(id, status);
  }

  const final = ledger.getCut(id)!;
  if (opts.record) await opts.record(final, pull?.id ?? null).catch(() => {});
  return done(id);
}

function done(id: number) {
  return { cut: ledger.getCut(id)!, submissions: ledger.submissionsFor(id) };
}
