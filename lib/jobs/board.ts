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
  /** The bank track under the voice, style-relative; null when the style has no bank. */
  music: string | null;
  /** True when the plugin cut the slides to the voice. */
  fitted: boolean;
  /** The detached build on the board: running, done, failed, or null when none was started. */
  build: BuildStatus;
  hasExport: boolean;
};

export type StageName = 'summarise' | 'plan' | 'script' | 'build';
export type BuildStatus = 'running' | 'done' | 'failed' | null;

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
      music: r.music ?? null,
      fitted: r.fitted === true,
      build: (r.build ?? null) as BuildStatus,
      hasExport: r.hasExport === true,
    };
  });
}

const SAFE_WEEK = /^\d{4}-W\d{2}$/;

const STAGES: StageName[] = ['summarise', 'plan', 'script', 'build'];

/**
 * Runs one of the board's stages. summarise and plan are instant; script asks the
 * plugin's writer (about a minute); build starts the detached render and returns at once.
 */
export async function runStage(
  week: string,
  stage: StageName,
  opts: BoardOpts & { style?: string } = {}
): Promise<{ ok: boolean; message?: string }> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  if (!STAGES.includes(stage)) throw new Error(`the board runs ${STAGES.join(', ')}, not "${stage}"`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${week}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.style ? { stage, style: opts.style } : { stage }),
      signal: AbortSignal.timeout(stage === 'script' ? 300_000 : 120_000),
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

export type SubmitReply = { ok: boolean; status: number; week?: string; counted?: number; rejected?: number; message?: string };

/** A cut for the board: the sheet import's shape, plus an optional brief and force. */
export async function submitJobs(
  key: string,
  body: Record<string, unknown> & { brief?: string; force?: boolean },
  opts: BoardOpts = {}
): Promise<SubmitReply> {
  if (!/^\d{4}-W\d{2}$|^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`"${key}" is not a period like 2026-W36 or 2026-09-03`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${key}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  const reply = (await res.json().catch(() => ({}))) as Omit<SubmitReply, 'status'>;
  return { ...reply, ok: res.ok && reply.ok !== false, status: res.status };
}

/** Where the board shows this week, and where its export lives. */
export const boardLinks = (week: string, base = jobsReelBase()) => ({
  board: `${base}/week/${week}`,
  reel: `${base}/api/weeks/${week}/reel.mp4`,
  preview: `${base}/preview/${week}`,
});

// ---- the request, per style ------------------------------------------------------------

export type StyleSpec = {
  style: string;
  displayName: string;
  world: string;
  captionMode: 'plain' | 'punch';
  fixed: { role: string; scene: string; seconds: number }[];
  elastic: { slots: string; secondsEach: string; rehook: string | null };
  request: {
    jobs: { method: string; path: string; body: string };
    script: { method: string; path: string; body: Record<string, unknown> };
    build: { method: string; path: string; body: Record<string, unknown> };
  };
};

async function getJson<T>(path: string, opts: BoardOpts, timeoutMs = TIMEOUT_MS): Promise<{ status: number; body: T }> {
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/** Every style pack the plugin renders, with its world, its beats and the requests it expects. */
export async function listStyles(opts: BoardOpts = {}): Promise<StyleSpec[]> {
  const r = await getJson<unknown>('/api/styles', opts);
  if (r.status !== 200 || !Array.isArray(r.body)) throw new BoardDown(`jobs-reel board answered ${r.status} for the styles`);
  return r.body as StyleSpec[];
}

export type WeekRequest = {
  week: string;
  style: string;
  world: string;
  counted: number;
  facts: Record<string, unknown>;
  beats: { id: string; role: string; scene: string; secondsPlanned: number; secondsMin: number; speaks: boolean; maxWords: number; describe: string; shows: string | null; highlight: string | null }[];
  submit: { method: string; path: string; body: Record<string, unknown> };
};

/** The concrete template for a submitted week in one style; the plugin plans it while answering. */
export async function weekRequest(week: string, style: string, opts: BoardOpts = {}): Promise<WeekRequest> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const r = await getJson<WeekRequest & { error?: string }>(`/api/weeks/${week}/request?style=${encodeURIComponent(style)}`, opts);
  if (r.status !== 200) throw new BoardDown(r.body.error ?? `jobs-reel board answered ${r.status} for the request`);
  return r.body;
}

export type BoardLines = { style: string; world: string; lines: { beatId: string; role: string; text: string }[] };

/** The lines the plugin wrote for a week, ready to record. */
export async function readLines(week: string, opts: BoardOpts = {}): Promise<BoardLines> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const r = await getJson<BoardLines & { error?: string }>(`/api/weeks/${week}/script`, opts);
  if (r.status !== 200) throw new BoardDown(r.body.error ?? `jobs-reel board answered ${r.status} for the lines`);
  return r.body;
}

export type ScriptSubmission = {
  style: string;
  provider?: string;
  lines: { beatId: string; text: string; audio?: { format: 'wav' | 'mp3'; base64: string } }[];
};
export type ScriptReply = { ok: boolean; status: number; message?: string; recorded?: number; fitted?: boolean; durationSec?: number };

/** The lines with their recordings; the plugin measures them and cuts the timeline to them. */
export async function submitScript(week: string, body: ScriptSubmission, opts: BoardOpts = {}): Promise<ScriptReply> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const { base, http } = client(opts);
  let res: Response;
  try {
    res = await http(`${base}/api/weeks/${week}/script`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new BoardDown(`jobs-reel board is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}`);
  }
  const reply = (await res.json().catch(() => ({}))) as Omit<ScriptReply, 'status'>;
  return { ...reply, ok: res.ok && reply.ok !== false, status: res.status };
}

export type BuildView = { week: string; build: { status: 'running' | 'done' | 'failed'; pid: number; startedAt: string; endedAt?: string; code?: number | null } | null; log: string };

/** Where the detached build is, with the tail of its log. */
export async function buildStatus(week: string, opts: BoardOpts = {}): Promise<BuildView> {
  if (!SAFE_WEEK.test(week)) throw new Error(`"${week}" is not a week like 2026-W36`);
  const r = await getJson<BuildView>(`/api/weeks/${week}/build`, opts);
  if (r.status !== 200) throw new BoardDown(`jobs-reel board answered ${r.status} for the build`);
  return r.body;
}

