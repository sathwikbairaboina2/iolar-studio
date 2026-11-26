import { promises as fs } from 'fs';
import path from 'path';
import * as ledger from './ledger';
import { BoardDown, boardLinks, buildStatus, jobsReelBase, listWeeks, readWeek, type BoardOpts } from './board';
import { mapExperience, mapFunction, mapLocation } from './map';
import { dayKey } from './period';
import { JobSchema, type ReelJob } from './reelSchema';
import { submitCut, type SubmitOpts } from './submit';
import { summarise } from './summarise';
import { keywordField, postToIntabot } from '@/lib/jobcard/handoff';
import type { PanelJob } from '@/lib/jobcard/panelJob';
import { PLUGINS } from '@/lib/plugins/registry';

/**
 * A reel from the jobs the control room picked, on the same path the period cuts take.
 * The jobs become a cut in the ledger (a day's cut, marked with the control room's content
 * id), the cut is submitted to the jobs-reel board stage by stage, and the panel asks for
 * its status until the export exists, then has Studio hand the mp4 to IntaBot.
 */

export class BoardNotRunning extends Error {
  constructor() {
    super('jobs-reel plugin is not running');
  }
}
export class NothingToCut extends Error {
  constructor(readonly reasons: string[]) {
    super(`none of the jobs can make a reel row: ${reasons.join('; ')}`);
  }
}

// ---- rows -------------------------------------------------------------------------------

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * Rupees for the plugin's bands. LPA is lakhs a year; any other INR unit is taken as rupees
 * when it is a believable salary. Another currency, or a figure that cannot be read, is no
 * band at all: a wrong band is worse than none.
 */
function pay(job: PanelJob): { salaryMin: number | null; salaryMax: number | null } {
  const s = job.salary;
  if (!s || clean(s.currency || 'INR').toUpperCase() !== 'INR') return { salaryMin: null, salaryMax: null };
  const scale = clean(s.unit || 'LPA').toUpperCase() === 'LPA' ? 100_000 : 1;
  const lo = Math.round(s.min * scale);
  const hi = Math.round(s.max * scale);
  if (!(lo >= 50_000) || !(hi >= lo)) return { salaryMin: null, salaryMax: null };
  return { salaryMin: lo, salaryMax: hi };
}

export type RowResult = { ok: true; row: ReelJob } | { ok: false; reason: string };

/** One panel job as the plugin's row, or why the plugin would refuse it. */
export function rowFromJob(job: PanelJob, key: string, now: Date): RowResult {
  const role = clean(job.role);
  const hasExp = typeof job.experience?.min === 'number' || typeof job.experience?.max === 'number';
  const fallback = mapExperience(role, '');
  const min = hasExp ? Math.min(50, Math.max(0, Math.round(job.experience?.min ?? job.experience?.max ?? 0))) : fallback.min;
  const maxRaw = hasExp ? Math.round(job.experience?.max ?? min) : fallback.max;
  const remote = job.workMode === 'remote';

  const candidate = {
    id: `${job.id}|${key}`,
    role,
    company: clean(job.company),
    function: mapFunction(role, job.attrs?.skills ?? []) ?? 'other',
    location: mapLocation({ location: clean(job.city), locations: [], remote }),
    workMode: job.workMode ?? 'onsite',
    experienceMin: min,
    experienceMax: Math.min(50, Math.max(min, maxRaw)),
    ...pay(job),
    currency: 'INR',
    postedOn: clean(job.firstSeen).slice(0, 10) || now.toISOString().slice(0, 10),
    closesOn: null,
    link: clean(job.applyUrl) || clean(job.originalUrl) || clean(job.sourceUrl),
  };
  const parsed = JobSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, row: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `${job.id}: ${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}` };
}

// ---- starting ---------------------------------------------------------------------------

export type FromJobsInput = { contentId: string; title: string; jobs: PanelJob[] };

export type StartedCut = {
  cut: ledger.Cut;
  boardUrl: string;
  /** Resolves when the submit to the board has finished; the route does not wait for it. */
  done: Promise<void>;
};

/** The board keeps a period per key and takes days or ISO weeks only, so each content takes the next free day. */
function freeDay(now: Date): string {
  for (let i = 0; i < 60; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const key = dayKey(d);
    if (!ledger.getCutByPeriod(key, 'daily')) return key;
  }
  throw new Error('no free day for a jobs reel in the next 60 days');
}

const baseOf = (opts: BoardOpts) => (opts.baseUrl ?? jobsReelBase()).replace(/\/$/, '');

export async function startCutFromJobs(input: FromJobsInput, opts: SubmitOpts = {}): Promise<StartedCut> {
  const now = opts.now ?? new Date();

  // Nothing is written until the board answers: a plugin that is down is one clear error.
  try {
    await listWeeks(opts);
  } catch (err) {
    if (err instanceof BoardDown) throw new BoardNotRunning();
    throw err;
  }

  const existing = ledger.findCutByContent(input.contentId);
  if (existing && existing.status !== 'failed') {
    return { cut: existing, boardUrl: boardLinks(existing.periodKey, baseOf(opts)).board, done: Promise.resolve() };
  }
  const key = existing?.periodKey ?? freeDay(now);

  const results = input.jobs.map((j) => rowFromJob(j, key, now));
  const accepted = results.flatMap((r) => (r.ok ? [r.row] : []));
  const reasons = results.flatMap((r) => (r.ok ? [] : [r.reason]));
  if (!accepted.length) throw new NothingToCut(reasons);

  const cut = ledger.createCut(
    {
      periodKey: key,
      kind: 'daily',
      windowFrom: key,
      windowTo: key,
      filter: { fromJobs: true, contentId: input.contentId, title: input.title, jobIds: input.jobs.map((j) => j.id) },
      // Chosen by hand, so never "thin": the pull threshold is for cuts nobody chose.
      status: 'prepared',
      counted: accepted.length,
      rejected: reasons.length,
      summary: summarise({ week: key, jobs: accepted, rejected: reasons.map((why, i) => ({ row: i + 1, why, raw: {} })) }, now),
      briefMd: null,
    },
    { now: now.toISOString() }
  );
  // A job the pool never saw has no research id. Negative ids cannot meet a real one, and they
  // rise with the position, because the cut is read back ordered by id and the reel plays in the order picked.
  ledger.replaceCutRows(
    cut.id,
    results.map((r, n) => ({
      cutId: cut.id,
      researchId: n - 1_000_000,
      row: r.ok ? (r.row as unknown as Record<string, unknown>) : null,
      mappedBy: r.ok ? ('rule' as const) : ('rejected' as const),
      rejectReason: r.ok ? null : r.reason,
    }))
  );

  const done = submitCut(cut.id, { ...opts, now }).then(
    () => {},
    (err) => {
      ledger.addSubmission({
        cutId: cut.id, at: new Date().toISOString(), accepted: accepted.length, rejected: reasons.length,
        stage: null, reply: null, error: String(err instanceof Error ? err.message : err),
      });
      ledger.setCutStatus(cut.id, 'failed');
    }
  );
  return { cut, boardUrl: boardLinks(key, baseOf(opts)).board, done };
}

// ---- status -----------------------------------------------------------------------------

export type CutProgress = { status: 'planning' | 'voicing' | 'building' | 'exported' | 'failed'; videoUrl?: string; error?: string };

const isFromJobs = (cut: ledger.Cut | null): cut is ledger.Cut => !!cut && cut.filter?.fromJobs === true;

/**
 * Where a cut from jobs is, read from the ledger and, once the build is on the board, from
 * the board itself. Null for a cut that is not one of these. A board that is needed and
 * silent raises BoardDown.
 */
export async function cutStatus(id: number, opts: BoardOpts = {}): Promise<CutProgress | null> {
  const cut = ledger.getCut(id);
  if (!isFromJobs(cut)) return null;

  if (cut.status === 'failed') {
    const why = ledger.submissionsFor(id).filter((s) => s.error).at(-1)?.error;
    return { status: 'failed', error: why ?? 'the cut failed' };
  }
  if (cut.status === 'scripted') return { status: 'voicing' };
  if (cut.status !== 'voiced' && cut.status !== 'building') return { status: 'planning' };

  const week = await readWeek(cut.periodKey, opts);
  if (week.hasExport) return { status: 'exported', videoUrl: boardLinks(cut.periodKey, baseOf(opts)).reel };
  const { build, log: tail } = await buildStatus(cut.periodKey, opts);
  if (build?.status === 'failed') {
    const log = tail.split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
    return { status: 'failed', error: `the build failed${build.code != null ? ` (exit code ${build.code})` : ''}${log ? `: ${log}` : ''}` };
  }
  return { status: 'building' };
}

// ---- handoff ----------------------------------------------------------------------------

export type ReelHandoff = { contentId: string; caption?: string; keyword?: string; applyUrl?: string; accountId?: string };

export type ReelOutcome =
  | { status: 200; postId: string; accountId: string; caption: string; created: boolean }
  | { status: number; error: string; reelStatus?: string };

const jobsReelDir = () => process.env.JOBS_REEL_DIR ?? PLUGINS.find((p) => p.name === 'jobsreel')?.start?.cwd;

/**
 * The export, from the board's api; or, when that api serves only ISO weeks (a day's reel
 * is a 400 there), straight from the plugin's own folder, which is where the board wrote it.
 */
async function readExport(key: string, opts: BoardOpts): Promise<Buffer | null> {
  const http = opts.fetchImpl ?? fetch;
  try {
    const res = await http(boardLinks(key, baseOf(opts)).reel, { cache: 'no-store', signal: AbortSignal.timeout(120_000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  } catch {
    // Fall through to the folder.
  }
  const dir = jobsReelDir();
  if (!dir) return null;
  try {
    return await fs.readFile(path.join(dir, 'weeks', key, 'export', 'reel.mp4'));
  } catch {
    return null;
  }
}

export async function handoffReel(
  id: number,
  req: ReelHandoff,
  boardOpts: BoardOpts = {},
  deps: { http?: typeof fetch } = {}
): Promise<ReelOutcome> {
  const cut = ledger.getCut(id);
  if (!isFromJobs(cut)) return { status: 404, error: `no jobs reel cut ${id}` };

  let progress: CutProgress | null;
  try {
    progress = await cutStatus(id, boardOpts);
  } catch (err) {
    if (err instanceof BoardDown) return { status: 503, error: 'jobs-reel plugin is not running' };
    throw err;
  }
  if (progress?.status !== 'exported') {
    return { status: 409, error: 'the reel is not exported yet', reelStatus: progress?.status };
  }

  const key = process.env.INTABOT_HANDOFF_KEY;
  if (!key) return { status: 503, error: 'INTABOT_HANDOFF_KEY is not set, so Studio cannot hand reels to IntaBot' };

  const mp4 = await readExport(cut.periodKey, boardOpts);
  if (!mp4) return { status: 502, error: `could not read the exported reel for ${cut.periodKey}` };

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(mp4)], { type: 'video/mp4' }), `${req.contentId}.mp4`);
  form.append(
    'card',
    JSON.stringify({
      contentId: req.contentId,
      title: String(cut.filter.title ?? req.contentId),
      ...(req.caption ? { caption: req.caption } : {}),
      ...(req.applyUrl ? { applyUrl: req.applyUrl } : {}),
      ...keywordField(req.keyword),
      ...(req.accountId ? { accountId: req.accountId } : {}),
    })
  );

  const sent = await postToIntabot('/handoff/reel', form, key, deps, 180_000);
  if ('error' in sent) return sent;
  const { body } = sent;
  return { status: 200, postId: body.postId, accountId: body.accountId, caption: body.caption ?? '', created: body.created !== false };
}
