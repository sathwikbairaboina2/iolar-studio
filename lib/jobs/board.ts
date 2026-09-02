/**
 * The studio's view of the jobs-reel plugin.
 *
 * The plugin owns its weeks on disk and serves them from its board on :26100. The studio
 * does not read that disk; it asks the board, so the two never disagree about a week. The
 * browser never talks to the board's origin either — these calls run in the studio's own
 * routes, and a board that is down is one clear message on the Jobs page, not a CORS
 * failure in a console.
 */

export type WeekStage = 'empty' | 'imported' | 'planned' | 'scripted' | 'voiced' | 'exported';

export type WeekRow = {
  week: string;
  stage: WeekStage;
  counted: number;
  rejected: number;
  style: string | null;
  hasExport: boolean;
};

export type StageName = 'summarise' | 'plan';

export type BoardOpts = { baseUrl?: string; fetchImpl?: typeof fetch };

export class BoardDown extends Error {}

export const jobsReelBase = (): string =>
  (process.env.JOBS_REEL_URL ?? 'http://127.0.0.1:26100').replace(/\/$/, '');

const TIMEOUT_MS = 8000;

function client(opts: BoardOpts) {
  const base = (opts.baseUrl ?? jobsReelBase()).replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  return { base, http };
}

export async function listWeeks(opts: BoardOpts = {}): Promise<WeekRow[]> {
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  if (!res.ok) throw new BoardDown(`jobs-reel board answered ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new BoardDown('jobs-reel board sent something that is not a week list');
  return body.map((w) => {
    const r = w as Partial<WeekRow>;
    return {
      week: String(r.week ?? ''),
      stage: (r.stage ?? 'empty') as WeekStage,
      counted: Number(r.counted ?? 0),
      rejected: Number(r.rejected ?? 0),
      style: r.style ?? null,
      hasExport: r.hasExport === true,
    };
  });
}

const SAFE_WEEK = /^\d{4}-W\d{2}$/;

/** Re-runs one of the two stages the board itself allows. Voice, render and export stay in the terminal. */
export async function runStage(
  week: string,
  stage: StageName,
  opts: BoardOpts = {}
): Promise<{ ok: boolean; message?: string }> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  if (stage !== 'summarise' && stage !== 'plan') throw new Error(`the board only re-runs summarise or plan, not "${stage}"`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${week}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  return { ok: res.ok && body.ok !== false, message: body.message };
}

export type BoardJob = {
  id: string;
  role: string;
  company: string;
  function: string;
  location: string;
  workMode: string;
  experienceMin: number;
  experienceMax: number;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  link: string;
};

export type WeekView = {
  week: string;
  stage: WeekStage;
  hasExport: boolean;
  hasVoice: boolean;
  jobs: { jobs: BoardJob[]; rejected: unknown[] } | null;
  summary: Record<string, unknown> | null;
  reel: {
    style?: string | null;
    world?: string | null;
    highlights?: { highlight: string; scene: string; score: number }[];
  } | null;
};

/** The full week view, the one the board's own week page renders from. */
export async function readWeek(week: string, opts: BoardOpts = {}): Promise<WeekView> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${week}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  if (!res.ok) throw new BoardDown(`jobs-reel board answered ${res.status}`);
  return (await res.json()) as WeekView;
}

/** Where the board shows this week, and where its export lives. */
export const boardLinks = (week: string, base = jobsReelBase()) => ({
  board: `${base}/week/${week}`,
  reel: `${base}/api/weeks/${week}/reel.mp4`,
  preview: `${base}/preview/${week}`,
});
