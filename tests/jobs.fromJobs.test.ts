import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { panelJob, sparseJob } from './helpers/panelJob';

const NOW = new Date('2026-11-26T09:00:00.000Z');
const BASE = 'http://board.test:26100';
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]);

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-fromjobs-'));
  process.env.INTABOT_URL = 'http://intabot.test:4100';
  process.env.INTABOT_HANDOFF_KEY = 'k-1';
  process.env.JOBS_REEL_DIR = mkdtempSync(path.join(tmpdir(), 'is-jobsreel-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.INTABOT_URL;
  delete process.env.INTABOT_HANDOFF_KEY;
  delete process.env.JOBS_REEL_DIR;
  delete process.env.JOBS_REEL_URL;
  (await import('@/lib/db')).closeDb();
});

// ---- a board on fixtures ----------------------------------------------------------------

type Call = { method: string; path: string; body?: Record<string, unknown> };
type BoardState = {
  down?: boolean;
  /** period key -> what GET /api/weeks/<key> says */
  weeks?: Record<string, { hasExport?: boolean; stage?: string }>;
  build?: Record<string, { status: 'running' | 'done' | 'failed'; code?: number | null } | null>;
  log?: string;
  mp4Status?: number;
  refuse?: string;
};

function board(state: BoardState = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (state.down) throw new Error('connect ECONNREFUSED 127.0.0.1:26100');
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, path: u.pathname, body });
    const respond = (v: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => v, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;
    if (u.pathname === '/api/weeks') return respond([]);
    const m = u.pathname.match(/^\/api\/weeks\/([^/]+)(?:\/([^/]+))?$/);
    if (!m) return respond({ ok: false, message: 'no route' }, 404);
    const [, key, tail] = m;
    if (method === 'POST' && tail === 'jobs') return respond({ ok: true, week: key, counted: (body?.jobs as unknown[]).length, rejected: 0 });
    if (method === 'POST' && tail === 'run') {
      if (state.refuse === body?.stage) return respond({ ok: false, message: `${body?.stage} refused` }, 400);
      return respond({ ok: true, message: `${body?.stage} done` });
    }
    if (method === 'GET' && tail === 'build') return respond({ week: key, build: state.build?.[key] ?? null, log: state.log ?? '' });
    if (method === 'GET' && tail === 'reel.mp4') {
      if ((state.mp4Status ?? 200) !== 200) return respond({}, state.mp4Status);
      return { ok: true, status: 200, arrayBuffer: async () => MP4.buffer.slice(MP4.byteOffset, MP4.byteOffset + MP4.byteLength) } as unknown as Response;
    }
    if (method === 'GET' && !tail) {
      const w = state.weeks?.[key] ?? {};
      return respond({ week: key, stage: w.stage ?? 'planned', hasExport: w.hasExport === true, hasVoice: false, jobs: null, summary: null, reel: null });
    }
    return respond({ ok: false, message: 'no route' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls, opts: { baseUrl: BASE, fetchImpl: f } };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const jobs = (n: number) => Array.from({ length: n }, (_, i) => panelJob({ id: `job_${i}`, company: `Company${i}`, role: `Engineer ${i}` }));

// ---- rows -------------------------------------------------------------------------------

describe('a panel job as a reel row', () => {
  it('maps a full job to the plugin row: rupees from LPA, one name per city, a function, the apply link', async () => {
    const { rowFromJob } = await import('@/lib/jobs/fromJobs');
    const r = rowFromJob(panelJob({ city: 'Bangalore' }), '2026-11-26', NOW);
    expect(r).toEqual({
      ok: true,
      row: {
        id: 'job_zoho_sde|2026-11-26',
        role: 'Software Development Engineer',
        company: 'Zoho Corporation',
        function: 'engineering',
        location: 'Bengaluru',
        workMode: 'hybrid',
        experienceMin: 2,
        experienceMax: 5,
        salaryMin: 800_000,
        salaryMax: 1_800_000,
        currency: 'INR',
        postedOn: '2026-11-20',
        closesOn: null,
        link: 'https://aiiolar.com/jobs?job=zoho%7Csde',
      },
    });
  });

  it('keeps a job with no pay as null, null and falls back for experience and the date', async () => {
    const { rowFromJob } = await import('@/lib/jobs/fromJobs');
    const r = rowFromJob(sparseJob({ experience: null, firstSeen: null, role: 'Support Engineer' }), '2026-11-26', NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row).toMatchObject({ salaryMin: null, salaryMax: null, postedOn: '2026-11-26', experienceMin: 2, experienceMax: 5 });
    }
  });

  it('does not band pay in another currency, and uses a remote job\'s mode', async () => {
    const { rowFromJob } = await import('@/lib/jobs/fromJobs');
    const r = rowFromJob(panelJob({ city: '', workMode: 'remote', salary: { min: 90000, max: 120000, unit: 'year', currency: 'USD' } }), '2026-11-26', NOW);
    expect(r.ok && r.row).toMatchObject({ workMode: 'remote', location: 'Remote', salaryMin: null, salaryMax: null });
  });

  it('rejects a job the plugin would refuse, with the reason', async () => {
    const { rowFromJob } = await import('@/lib/jobs/fromJobs');
    const r = rowFromJob(panelJob({ applyUrl: null, originalUrl: null, sourceUrl: 'not a url' }), '2026-11-26', NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('link') });
  });
});

// ---- starting a cut ---------------------------------------------------------------------

async function start(over: { jobs?: ReturnType<typeof jobs>; contentId?: string; state?: BoardState; voice?: 'plugin' } = {}) {
  const { startCutFromJobs } = await import('@/lib/jobs/fromJobs');
  const b = board(over.state);
  const out = await startCutFromJobs(
    { contentId: over.contentId ?? 'c-1', title: 'Five jobs', jobs: over.jobs ?? jobs(5) },
    { ...b.opts, voice: over.voice ?? 'plugin', now: NOW }
  );
  return { ...out, ...b };
}

describe('a reel cut from given jobs', () => {
  it('builds a cut of exactly those jobs and submits it to the board stage by stage', async () => {
    const out = await start();
    expect(out.boardUrl).toBe(`${BASE}/week/2026-11-26`);
    expect(out.cut).toMatchObject({ periodKey: '2026-11-26', kind: 'daily', counted: 5, status: 'prepared' });
    await out.done;

    const ledger = await import('@/lib/jobs/ledger');
    const cut = ledger.getCut(out.cut.id)!;
    expect(cut.status).toBe('building');
    expect(cut.filter).toMatchObject({ fromJobs: true, contentId: 'c-1', title: 'Five jobs' });

    const posted = out.calls.find((c) => c.method === 'POST' && c.path === '/api/weeks/2026-11-26/jobs')!;
    const rows = posted.body!.jobs as { id: string; company: string }[];
    expect(rows.map((r) => r.id)).toEqual(jobs(5).map((j) => `${j.id}|2026-11-26`));
    expect(rows.map((r) => r.company)).toEqual(['Company0', 'Company1', 'Company2', 'Company3', 'Company4']);
    expect(posted.body!.source).toMatchObject({ kind: 'studio', cutId: cut.id });

    const stages = out.calls.filter((c) => c.path.endsWith('/run')).map((c) => c.body!.stage);
    expect(stages).toEqual(['summarise', 'plan', 'script', 'build']);
    // A short cut is the owner's choice, not a thin pull: nothing holds it back.
    expect(ledger.cutRows(cut.id)).toHaveLength(5);
  });

  it('does not touch the database or the board when the board is down, and says so', async () => {
    const { startCutFromJobs, BoardNotRunning } = await import('@/lib/jobs/fromJobs');
    const b = board({ down: true });
    await expect(startCutFromJobs({ contentId: 'c-1', title: 't', jobs: jobs(2) }, { ...b.opts, now: NOW })).rejects.toBeInstanceOf(BoardNotRunning);
    const ledger = await import('@/lib/jobs/ledger');
    expect(ledger.listCuts()).toHaveLength(0);
  });

  it('answers a repeat of the same content with the same cut and submits once', async () => {
    const first = await start();
    await first.done;
    const again = await start();
    expect(again.cut.id).toBe(first.cut.id);
    await again.done;
    expect(again.calls.filter((c) => c.path.endsWith('/run'))).toHaveLength(0);
  });

  it('gives another content its own day when today is taken', async () => {
    const first = await start();
    await first.done;
    const second = await start({ contentId: 'c-2' });
    await second.done;
    expect(second.cut.id).not.toBe(first.cut.id);
    expect(second.cut.periodKey).toBe('2026-11-27');
  });

  it('retries a failed cut of the same content on its own day', async () => {
    const first = await start({ state: { refuse: 'plan' } });
    await first.done;
    const ledger = await import('@/lib/jobs/ledger');
    expect(ledger.getCut(first.cut.id)!.status).toBe('failed');
    const retry = await start();
    expect(retry.cut.id).toBe(first.cut.id);
    await retry.done;
    expect(ledger.getCut(first.cut.id)!.status).toBe('building');
  });

  it('refuses jobs the plugin would refuse, naming them, when none are left', async () => {
    const { startCutFromJobs, NothingToCut } = await import('@/lib/jobs/fromJobs');
    const b = board();
    const bad = [panelJob({ id: 'x', applyUrl: null, originalUrl: null, sourceUrl: '' }), panelJob({ id: 'y', applyUrl: null, originalUrl: null, sourceUrl: '' })];
    await expect(startCutFromJobs({ contentId: 'c-1', title: 't', jobs: bad }, { ...b.opts, now: NOW })).rejects.toBeInstanceOf(NothingToCut);
  });

  it('keeps going with the good jobs and records the rejected ones on the cut', async () => {
    const mixed = [...jobs(2), panelJob({ id: 'bad', applyUrl: null, originalUrl: null, sourceUrl: '' })];
    const out = await start({ jobs: mixed });
    await out.done;
    expect(out.cut.counted).toBe(2);
    expect(out.cut.rejected).toBe(1);
  });
});

// ---- status -----------------------------------------------------------------------------

describe('the status of a cut from jobs', () => {
  async function cutAt(status: string, state: BoardState = {}) {
    const out = await start({ state });
    await out.done;
    const ledger = await import('@/lib/jobs/ledger');
    ledger.setCutStatus(out.cut.id, status as never);
    return out.cut.id;
  }
  const statusOf = async (id: number, state: BoardState = {}) => {
    const { cutStatus } = await import('@/lib/jobs/fromJobs');
    return cutStatus(id, board(state).opts);
  };

  it('is planning before the lines exist, voicing once they do, building after the recording', async () => {
    const id = await cutAt('planned');
    expect(await statusOf(id)).toEqual({ status: 'planning' });
    const ledger = await import('@/lib/jobs/ledger');
    ledger.setCutStatus(id, 'scripted');
    expect(await statusOf(id)).toEqual({ status: 'voicing' });
    ledger.setCutStatus(id, 'building');
    expect(await statusOf(id, { build: { '2026-11-26': { status: 'running' } } })).toEqual({ status: 'building' });
  });

  it('is exported with the reel url once the board has the export', async () => {
    const id = await cutAt('building');
    expect(await statusOf(id, { weeks: { '2026-11-26': { hasExport: true, stage: 'exported' } } })).toEqual({
      status: 'exported',
      videoUrl: `${BASE}/api/weeks/2026-11-26/reel.mp4`,
    });
  });

  it('is failed with the reason: the ledger\'s, or the build\'s own', async () => {
    const failed = await start({ state: { refuse: 'plan' } });
    await failed.done;
    expect(await statusOf(failed.cut.id)).toEqual({ status: 'failed', error: 'plan refused' });

    const id = await cutAt('building');
    const s = await statusOf(id, { build: { '2026-11-26': { status: 'failed', code: 1 } }, log: 'render started\nffmpeg exited with code 1' });
    expect(s).toEqual({ status: 'failed', error: expect.stringContaining('ffmpeg exited with code 1') });
  });

  it('is null for a cut that does not exist and a cut that is not from jobs', async () => {
    const { cutStatus } = await import('@/lib/jobs/fromJobs');
    expect(await cutStatus(99, board().opts)).toBeNull();
    const ledger = await import('@/lib/jobs/ledger');
    const weekly = ledger.createCut({
      periodKey: '2026-W48', kind: 'weekly', windowFrom: '2026-11-23', windowTo: '2026-11-29', filter: {},
      status: 'prepared', counted: 25, rejected: 0, summary: null, briefMd: null,
    });
    expect(await cutStatus(weekly.id, board().opts)).toBeNull();
  });

  it('raises BoardDown when the board has to be asked and is not there', async () => {
    const id = await cutAt('building');
    const { BoardDown } = await import('@/lib/jobs/board');
    await expect(statusOf(id, { down: true })).rejects.toBeInstanceOf(BoardDown);
  });
});

// ---- handoff ----------------------------------------------------------------------------

describe('handing the exported reel to IntaBot', () => {
  const bot = (answer: () => Response | Error = () => json({ postId: 'post-r1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: true }, 201)) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const v = answer();
      if (v instanceof Error) throw v;
      return v;
    }) as unknown as typeof fetch;
    return { calls, http };
  };

  async function exported(state: BoardState = {}) {
    const out = await start({ state: { weeks: { '2026-11-26': { hasExport: true } }, ...state } });
    await out.done;
    return out;
  }

  it('answers 409 and calls nothing when the reel is not exported yet', async () => {
    const out = await start();
    await out.done;
    const { handoffReel } = await import('@/lib/jobs/fromJobs');
    const b = bot();
    const r = await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...board().opts }, { http: b.http });
    expect(r).toMatchObject({ status: 409, error: expect.stringMatching(/not exported/) });
    expect(b.calls).toHaveLength(0);
  });

  it('posts the mp4 and the content card to the reel route and returns the post', async () => {
    const out = await exported();
    const { handoffReel } = await import('@/lib/jobs/fromJobs');
    const b = bot();
    const r = await handoffReel(out.cut.id, { contentId: 'c-1', caption: 'Watch this', keyword: 'jobs' }, { ...out.opts }, { http: b.http });
    expect(r).toMatchObject({ status: 200, postId: 'post-r1', accountId: 'acct-1', created: true });
    expect(b.calls[0].url).toBe('http://intabot.test:4100/handoff/reel');
    expect((b.calls[0].init.headers as Record<string, string>)['x-handoff-key']).toBe('k-1');
    const form = b.calls[0].init.body as FormData;
    const file = form.get('file') as File;
    expect(file.type).toBe('video/mp4');
    expect(Buffer.from(await file.arrayBuffer()).equals(MP4)).toBe(true);
    expect(JSON.parse(String(form.get('card')))).toEqual({ contentId: 'c-1', title: 'Five jobs', caption: 'Watch this', keyword: 'JOBS' });
  });

  it('reads the export from the plugin\'s folder when its api serves only weeks', async () => {
    const out = await exported({ mp4Status: 400 });
    const dir = path.join(process.env.JOBS_REEL_DIR!, 'weeks', '2026-11-26', 'export');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'reel.mp4'), MP4);
    const { handoffReel } = await import('@/lib/jobs/fromJobs');
    const b = bot();
    const r = await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...out.opts }, { http: b.http });
    expect(r.status).toBe(200);
    expect(Buffer.from(await ((b.calls[0].init.body as FormData).get('file') as File).arrayBuffer()).equals(MP4)).toBe(true);
  });

  it('answers 502 when the export cannot be read anywhere', async () => {
    const out = await exported({ mp4Status: 404 });
    const { handoffReel } = await import('@/lib/jobs/fromJobs');
    const r = await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...out.opts }, { http: bot().http });
    expect(r).toMatchObject({ status: 502, error: expect.stringMatching(/reel/) });
  });

  it('passes IntaBot refusals through, 502 when it is down, 503 without the key, 404 for no cut', async () => {
    const out = await exported();
    const { handoffReel } = await import('@/lib/jobs/fromJobs');
    expect(await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...out.opts }, { http: bot(() => json({ message: 'Unauthorized' }, 401)).http })).toMatchObject({ status: 401 });
    expect(await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...out.opts }, { http: bot(() => new Error('connect ECONNREFUSED')).http })).toMatchObject({ status: 502 });
    expect(await handoffReel(404, { contentId: 'c-1' }, { ...out.opts }, { http: bot().http })).toMatchObject({ status: 404 });
    delete process.env.INTABOT_HANDOFF_KEY;
    expect(await handoffReel(out.cut.id, { contentId: 'c-1' }, { ...out.opts }, { http: bot().http })).toMatchObject({ status: 503 });
  });
});

// ---- routes -----------------------------------------------------------------------------

describe('the routes', () => {
  // The routes read the day from the clock; fixing only Date leaves the timers the tests wait on alone.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const post = (body?: unknown) =>
    new Request('http://studio.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  /** The board and IntaBot as global fetch sees them. */
  function stub(state: BoardState = {}, botAnswer?: () => Response) {
    process.env.JOBS_REEL_URL = BASE;
    const b = board(state);
    const botCalls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host === 'intabot.test:4100') {
        botCalls.push(u.pathname);
        return botAnswer ? botAnswer() : json({ postId: 'post-r1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: true }, 201);
      }
      return b.f(url, init);
    });
    return { ...b, botCalls };
  }

  it('POST /api/jobs/cuts/from-jobs answers 202 with the cut and the board url, and finishes in the background', async () => {
    const s = stub();
    const route = await import('@/app/api/jobs/cuts/from-jobs/route');
    const reply = await route.POST(post({ contentId: 'c-1', title: 'Five jobs', jobs: jobs(3), voice: 'plugin' }));
    expect(reply.status).toBe(202);
    const body = await reply.json();
    expect(body).toMatchObject({ cutId: expect.any(Number), boardUrl: expect.stringMatching(/\/week\/\d{4}-\d{2}-\d{2}$/), status: 'planning' });
    await vi.waitFor(async () => {
      const ledger = await import('@/lib/jobs/ledger');
      expect(ledger.getCut(body.cutId)!.status).toBe('building');
    });
    expect(s.calls.some((c) => c.path.endsWith('/run') && c.body?.stage === 'build')).toBe(true);
  });

  it('answers 503 when the plugin is not running, 400 for a bad body', async () => {
    stub({ down: true });
    const route = await import('@/app/api/jobs/cuts/from-jobs/route');
    const down = await route.POST(post({ contentId: 'c-1', title: 't', jobs: jobs(2) }));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: 'jobs-reel plugin is not running' });

    expect((await route.POST(post({ title: 't', jobs: jobs(2) }))).status).toBe(400);
    expect((await route.POST(post({ contentId: 'c', title: 't', jobs: [] }))).status).toBe(400);
    expect((await route.POST(post({ contentId: 'c', title: 't', jobs: [{ nope: 1 }] }))).status).toBe(400);
  });

  it('answers 422 when none of the jobs can make a row', async () => {
    stub();
    const route = await import('@/app/api/jobs/cuts/from-jobs/route');
    const bad = [panelJob({ id: 'x', applyUrl: null, originalUrl: null, sourceUrl: '' })];
    expect((await route.POST(post({ contentId: 'c', title: 't', jobs: bad }))).status).toBe(422);
  });

  it('GET /api/jobs/cuts/[id]/status maps the cut, 404 for an unknown one, 503 when the board is needed and down', async () => {
    const s = stub({ weeks: { '2026-11-26': { hasExport: true } } });
    const start = await import('@/app/api/jobs/cuts/from-jobs/route');
    const statusRoute = await import('@/app/api/jobs/cuts/[id]/status/route');
    const { cutId } = await (await start.POST(post({ contentId: 'c-1', title: 't', jobs: jobs(3), voice: 'plugin' }))).json();
    const ctx = (id: unknown) => ({ params: Promise.resolve({ id: String(id) }) });
    await vi.waitFor(async () => {
      const ledger = await import('@/lib/jobs/ledger');
      expect(ledger.getCut(cutId)!.status).toBe('building');
    });
    const ok = await statusRoute.GET(new Request('http://x'), ctx(cutId));
    expect(await ok.json()).toEqual({ status: 'exported', videoUrl: `${BASE}/api/weeks/${(await (await import('@/lib/jobs/ledger')).getCut(cutId))!.periodKey}/reel.mp4` });
    expect((await statusRoute.GET(new Request('http://x'), ctx(999))).status).toBe(404);
    expect((await statusRoute.GET(new Request('http://x'), ctx('abc'))).status).toBe(404);

    s.calls.length = 0;
    stub({ down: true });
    const down = await statusRoute.GET(new Request('http://x'), ctx(cutId));
    expect(down.status).toBe(503);
  });

  it('POST /api/jobs/cuts/[id]/handoff answers 409 until exported, then hands the reel over', async () => {
    const s = stub();
    const start = await import('@/app/api/jobs/cuts/from-jobs/route');
    const handoff = await import('@/app/api/jobs/cuts/[id]/handoff/route');
    const { cutId } = await (await start.POST(post({ contentId: 'c-1', title: 'Three jobs', jobs: jobs(3), voice: 'plugin' }))).json();
    await vi.waitFor(async () => {
      const ledger = await import('@/lib/jobs/ledger');
      expect(ledger.getCut(cutId)!.status).toBe('building');
    });
    const ctx = { params: Promise.resolve({ id: String(cutId) }) };
    const early = await handoff.POST(post({ contentId: 'c-1' }), ctx);
    expect(early.status).toBe(409);
    expect(s.botCalls).toHaveLength(0);

    const key = (await (await import('@/lib/jobs/ledger')).getCut(cutId))!.periodKey;
    stub({ weeks: { [key]: { hasExport: true } } });
    const reply = await handoff.POST(post({ contentId: 'c-1', caption: 'Watch' }), ctx);
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ postId: 'post-r1', accountId: 'acct-1', created: true });

    expect((await handoff.POST(post({}), ctx)).status).toBe(400);
  });

  it('answers 503 on handoff when the plugin is down', async () => {
    stub({ down: true });
    const handoff = await import('@/app/api/jobs/cuts/[id]/handoff/route');
    const ledger = await import('@/lib/jobs/ledger');
    const cut = ledger.createCut({
      periodKey: '2026-11-26', kind: 'daily', windowFrom: '2026-11-26', windowTo: '2026-11-26',
      filter: { fromJobs: true, contentId: 'c-1', title: 't' }, status: 'building', counted: 3, rejected: 0, summary: null, briefMd: null,
    });
    const reply = await handoff.POST(post({ contentId: 'c-1' }), { params: Promise.resolve({ id: String(cut.id) }) });
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ error: 'jobs-reel plugin is not running' });
  });
});
