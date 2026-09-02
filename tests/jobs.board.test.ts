import { describe, it, expect, vi } from 'vitest';
import { listWeeks, runStage, boardLinks, BoardDown } from '@/lib/jobs/board';

/**
 * The Jobs tab is a window onto the jobs-reel plugin's board. It shows what the board
 * says, re-runs only what the board lets it, and a board that is down is a sentence, not
 * a stack trace.
 */

type Call = { url: string; init?: RequestInit };

function fetchWith(reply: (url: string) => { status?: number; body?: unknown; fail?: boolean }, calls: Call[] = []) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url);
    if (r.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:26100');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('listing weeks', () => {
  it('asks the board and keeps the shape the page renders', async () => {
    const { f, calls } = fetchWith(() => ({
      body: [
        { week: '2026-W46', stage: 'exported', counted: 150, rejected: 0, style: 'feed', hasExport: true },
        { week: '2026-W45', stage: 'planned', counted: 120, rejected: 3, style: null, hasExport: false },
      ],
    }));
    const rows = await listWeeks({ baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(calls[0].url).toBe('http://127.0.0.1:26100/api/weeks');
    expect(rows).toEqual([
      { week: '2026-W46', stage: 'exported', counted: 150, rejected: 0, style: 'feed', music: null, fitted: false, build: null, hasExport: true },
      { week: '2026-W45', stage: 'planned', counted: 120, rejected: 3, style: null, music: null, fitted: false, build: null, hasExport: false },
    ]);
  });

  it('says the board is down in one sentence', async () => {
    const { f } = fetchWith(() => ({ fail: true }));
    await expect(listWeeks({ baseUrl: 'http://127.0.0.1:26100', fetchImpl: f })).rejects.toThrow(BoardDown);
    await expect(listWeeks({ baseUrl: 'http://127.0.0.1:26100', fetchImpl: f })).rejects.toThrow(/not answering on http:\/\/127\.0\.0\.1:26100/);
  });
});

describe('re-running a stage', () => {
  it('posts the stage to the board and relays its verdict', async () => {
    const { f, calls } = fetchWith(() => ({ body: { ok: true } }));
    const out = await runStage('2026-W46', 'plan', { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(out).toEqual({ ok: true, message: undefined });
    expect(calls[0].url).toBe('http://127.0.0.1:26100/api/weeks/2026-W46/run');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ stage: 'plan' });
  });

  it('relays a refusal with the board\'s reason', async () => {
    const { f } = fetchWith(() => ({ status: 409, body: { ok: false, message: 'no jobs.json yet' } }));
    const out = await runStage('2026-W46', 'summarise', { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(out).toEqual({ ok: false, message: 'no jobs.json yet' });
  });

  it('refuses stages the board does not offer, and weeks that are not weeks, before any call', async () => {
    const { f, calls } = fetchWith(() => ({ body: { ok: true } }));
    await expect(runStage('2026-W46', 'render' as never, { fetchImpl: f })).rejects.toThrow(/summarise, plan, script, build/);
    await expect(runStage('../etc', 'plan', { fetchImpl: f })).rejects.toThrow(/not a week/);
    expect(calls).toEqual([]);
  });
});

describe('reading one week', () => {
  it('asks the board for the full week view', async () => {
    const { readWeek } = await import('@/lib/jobs/board');
    const { f, calls } = fetchWith(() => ({
      body: { week: '2026-W46', stage: 'exported', jobs: null, summary: null, reel: null, hasExport: true, hasVoice: true },
    }));
    const v = await readWeek('2026-W46', { baseUrl: 'http://127.0.0.1:26100', fetchImpl: f });
    expect(calls[0].url).toBe('http://127.0.0.1:26100/api/weeks/2026-W46');
    expect(v.stage).toBe('exported');
    await expect(readWeek('../x', { fetchImpl: f })).rejects.toThrow(/not a week/);
  });
});

describe('links into the board', () => {
  it('point at the board, the reel and the preview for a week', () => {
    expect(boardLinks('2026-W46', 'http://127.0.0.1:26100')).toEqual({
      board: 'http://127.0.0.1:26100/week/2026-W46',
      reel: 'http://127.0.0.1:26100/api/weeks/2026-W46/reel.mp4',
      preview: 'http://127.0.0.1:26100/preview/2026-W46',
    });
  });
});

describe('the request client', () => {
  it('reads the style catalogue, a week request, the lines, posts recordings, and reads the build', async () => {
    const { listStyles, weekRequest, readLines, submitScript, buildStatus } = await import('@/lib/jobs/board');
    const calls: { url: string; body?: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
      if (u.endsWith('/api/styles')) return json([{ style: 'chat', world: 'group-chat' }]);
      if (u.includes('/request?style=chat')) return json({ week: '2026-W36', style: 'chat', beats: [] });
      if (u.endsWith('/script') && init?.method === 'POST') return json({ ok: true, recorded: 2, fitted: true, durationSec: 41.2 });
      if (u.endsWith('/script')) return json({ style: 'chat', world: 'group-chat', lines: [{ beatId: 'b2', role: 'hook', text: 'x' }] });
      if (u.endsWith('/build')) return json({ week: '2026-W36', build: { status: 'running', pid: 5, startedAt: 't' }, log: 'building' });
      return json({ error: 'no route' }, 404);
    }) as unknown as typeof fetch;
    const o = { baseUrl: 'http://x', fetchImpl: f };
    expect((await listStyles(o))[0]).toMatchObject({ style: 'chat' });
    expect((await weekRequest('2026-W36', 'chat', o)).style).toBe('chat');
    expect((await readLines('2026-W36', o)).lines[0].beatId).toBe('b2');
    const r = await submitScript('2026-W36', { style: 'chat', lines: [{ beatId: 'b2', text: 'x', audio: { format: 'mp3', base64: 'AA==' } }] }, o);
    expect(r).toMatchObject({ ok: true, recorded: 2, fitted: true });
    expect((await buildStatus('2026-W36', o)).build?.status).toBe('running');
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/styles', 'http://x/api/weeks/2026-W36/request?style=chat', 'http://x/api/weeks/2026-W36/script',
      'http://x/api/weeks/2026-W36/script', 'http://x/api/weeks/2026-W36/build',
    ]);
  });
});

