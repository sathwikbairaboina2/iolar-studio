import * as ledger from './ledger';
import { classifyPrompt, mapRows, parseLabels, type Classifier } from './map';
import { keyFor, windowFor, type PeriodKind } from './period';
import { briefFor, defaultFilter, type PoolFilter, type ResearchJob } from './researchApi';
import { summarise } from './summarise';
import { getSettings } from '@/lib/settings';

/**
 * Prepare: the pool rows in a period's window become a cut, mapped, summarised, briefed
 * and stored. A cut under the thin threshold is stored as `thin` and never submitted by
 * itself. Preparing a period again replaces its rows while it is only prepared; once
 * submitted it needs force.
 */

export type PrepareOpts = {
  classify?: Classifier;
  brief?: (filter: PoolFilter) => Promise<string>;
  filter?: PoolFilter;
  now?: Date;
  force?: boolean;
};

/** qwen labels the titles no rule placed, one prompt per cut. */
export async function qwenClassify(titles: string[]): Promise<string[]> {
  if (!titles.length) return [];
  const { qwenRunner } = await import('@/lib/ai/qwen');
  const raw = await qwenRunner()(classifyPrompt(titles), { timeoutMs: 180_000 });
  return parseLabels(raw, titles.length);
}

export async function prepareCut(kind: PeriodKind, periodKey?: string, opts: PrepareOpts = {}): Promise<ledger.Cut> {
  const now = opts.now ?? new Date();
  const key = periodKey ?? keyFor(kind, now);
  const win = windowFor(key);
  if (win.kind !== kind) throw new Error(`"${key}" is a ${win.kind} period, not ${kind}`);
  const filter = opts.filter ?? defaultFilter();
  const thinBelow = getSettings().jobsThinBelow;

  const pool = ledger.poolInWindow(win.from, win.to, filter.category);
  const jobs = pool.map((p) => p.raw as unknown as ResearchJob);
  const rows = await mapRows(jobs, key, opts.classify ?? qwenClassify);
  const accepted = rows.filter((r) => r.row);
  const rejected = rows.filter((r) => !r.row);

  const summary = summarise(
    {
      week: key,
      jobs: accepted.map((r) => r.row as never),
      rejected: rejected.map((r, i) => ({ row: i + 1, why: r.rejectReason ?? 'rejected', raw: {} })),
    },
    now
  );
  const briefMd = await (opts.brief ?? briefFor)(filter).catch(() => '');

  const cut = ledger.createCut(
    {
      periodKey: key,
      kind,
      windowFrom: win.from,
      windowTo: win.to,
      filter: filter as unknown as Record<string, unknown>,
      status: accepted.length < thinBelow ? 'thin' : 'prepared',
      counted: accepted.length,
      rejected: rejected.length,
      summary,
      briefMd: briefMd || null,
    },
    { replaceSubmitted: opts.force === true, now: now.toISOString() }
  );
  ledger.replaceCutRows(
    cut.id,
    rows.map((r) => ({ ...r, cutId: cut.id }))
  );
  return cut;
}

export async function cutView(id: number) {
  const cut = ledger.getCut(id);
  if (!cut) return null;
  return { cut, rows: ledger.cutRows(id), submissions: ledger.submissionsFor(id) };
}
