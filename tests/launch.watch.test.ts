import { mkdtempSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { listReferences, readWatchState, writeWatchState } from '@/lib/launch/inbox';
import { launchInboxMediaDir } from '@/lib/paths';
import { maybeRunWatch, runWatch, shotsFromCuts, type WatchDeps } from '@/lib/launch/watch';

const NOW = new Date('2026-10-21T09:00:00Z');

const media = (sc: string, caption: string, taken = '2026-10-21T06:00:00Z') => ({ shortcode: sc, kind: 'reel', is_video: true, taken_at: taken, caption });

function setup(over: { routes?: Record<string, unknown>; deps?: Partial<WatchDeps>; launches?: string[] } = {}) {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    'GET /profiles': { items: [{ username: 'varunmayya' }] },
    'POST /profiles/varunmayya/sync': { queued: true },
    'GET /profiles/varunmayya/media?limit=30': { items: [
      media('AAAAA1', 'Gemini 4 just dropped'),
      media('AAAAA2', 'My morning routine', '2026-10-21T05:00:00Z'),
      media('OLD001', 'old', '2026-10-01T05:00:00Z'),
    ] },
    'POST /media/ensure': { statuses: { AAAAA1: 'ready' } },
    'GET /media/AAAAA1/full': 'MP4BYTES',
    ...over.routes,
  };
  const http = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname.replace(/^\/api/, '')}${u.search}`;
    calls.push(key);
    if (!(key in routes)) return new Response('nope', { status: 404 });
    const v = typeof routes[key] === 'function' ? (routes[key] as () => unknown)() : routes[key];
    if (v instanceof Error) throw v;
    return typeof v === 'string' ? new Response(v) : new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const prompts: string[] = [];
  const run = async (p: string) => {
    prompts.push(p);
    if (p.includes('Which of these')) {
      const launches = over.launches ?? ['AAAAA1'];
      return JSON.stringify({ reels: [...launches.map((s) => ({ shortcode: s, launch: true, topic: 'Gemini 4 launch' })), { shortcode: 'AAAAA2', launch: false, topic: '' }] });
    }
    return JSON.stringify({ kinds: ['talk', 'screen', 'broll'] });
  };
  const deps: WatchDeps = {
    http, base: 'http://x/api', run,
    transcribe: async () => ({ text: 'hello there' }),
    cuts: async () => [2.5, 6],
    duration: async () => 40,
    frames: async (_f, at) => at.map((_, i) => `frame${i}.png`),
    now: () => NOW, waitMs: 50, pollMs: 1,
    ...over.deps,
  };
  return { deps, calls, prompts };
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-watch-'));
});

describe('shotsFromCuts', () => {
  it('turns cuts into shots and drops ones under 0.2 s', () => {
    expect(shotsFromCuts([2.5, 6], 40)).toEqual([{ start: 0, end: 2.5 }, { start: 2.5, end: 6 }, { start: 6, end: 40 }]);
    expect(shotsFromCuts([2.5, 2.6, 39.9], 40)).toEqual([{ start: 0, end: 2.5 }, { start: 2.6, end: 39.9 }]);
  });
});

describe('runWatch', () => {
  it('adds only the launch, with topic, shots, transcript and kinds', async () => {
    const { deps, calls } = setup();
    const out = await runWatch(deps);
    expect(out).toMatchObject({ checked: 2, launches: 1, added: ['AAAAA1'], skipped: null });
    const [r] = await listReferences();
    expect(r).toMatchObject({ id: 'AAAAA1', creator: 'varunmayya', topic: 'Gemini 4 launch', transcript: 'hello there', durationSec: 40, status: 'new' });
    expect(r.shots).toEqual([{ start: 0, end: 2.5, kind: 'talk' }, { start: 2.5, end: 6, kind: 'screen' }, { start: 6, end: 40, kind: 'broll' }]);
    expect(existsSync(path.join(launchInboxMediaDir(), 'AAAAA1.mp4'))).toBe(true);
    expect(calls.some((c) => c.includes('OLD001'))).toBe(false);
    const st = await readWatchState();
    expect([...st.seen].sort()).toEqual(['AAAAA1', 'AAAAA2']);
    expect(st).toMatchObject({ running: false, lastDay: '2026-10-21', skipped: null });
  });

  it('asks for every sync, then waits for the instascraper queue to empty before reading the posts', async () => {
    let depth = 2;
    const { deps, calls } = setup({ routes: { 'GET /status': () => ({ queue_depth: depth > 0 ? depth-- : 0 }) } });
    await runWatch({ ...deps, syncWaitMs: 1000 });
    const lastStatus = calls.lastIndexOf('GET /status');
    expect(calls.filter((c) => c === 'GET /status').length).toBe(3);
    expect(calls.indexOf('POST /profiles/varunmayya/sync')).toBeLessThan(calls.indexOf('GET /status'));
    expect(calls.indexOf('GET /profiles/varunmayya/media?limit=30')).toBeGreaterThan(lastStatus);
  });

  it('reads the posts anyway when the queue never empties in time', async () => {
    const { deps } = setup({ routes: { 'GET /status': { queue_depth: 5 } } });
    const r = await runWatch({ ...deps, syncWaitMs: 5 });
    expect(r.added).toEqual(['AAAAA1']);
  });

  it('does not download or list a reel seen on an earlier run', async () => {
    const first = setup();
    await runWatch(first.deps);
    const second = setup();
    const out = await runWatch(second.deps);
    expect(out.added).toEqual([]);
    expect(second.calls.some((c) => c.includes('/full') || c.includes('/media/ensure'))).toBe(false);
    expect(await listReferences()).toHaveLength(1);
  });

  it('records "not reachable" when instascraper is down, and writes nothing', async () => {
    const { deps } = setup({ routes: { 'GET /profiles': new Error('ECONNREFUSED') } });
    const out = await runWatch(deps);
    expect(out.skipped).toBe('instascraper is not reachable');
    expect(await listReferences()).toEqual([]);
    const st = await readWatchState();
    expect(st.skipped).toEqual({ at: NOW.toISOString(), reason: 'instascraper is not reachable' });
    expect(st.running).toBe(false);
    expect(st.lastDay).toBeNull();
  });

  it('keeps the reference with an empty transcript and a note when whisper fails', async () => {
    const { deps } = setup({ deps: { transcribe: async () => { throw new Error('whisper missing'); } } });
    await runWatch(deps);
    const [r] = await listReferences();
    expect(r.transcript).toBe('');
    expect(r.note).toContain('no transcript: whisper missing');
    expect(r.shots).toHaveLength(3);
  });

  it('stops on a spent reel cap and downloads nothing', async () => {
    const { deps, calls } = setup({ routes: { 'POST /media/ensure': { statuses: { AAAAA1: 'quota' } } } });
    const out = await runWatch(deps);
    expect(out.skipped).toMatch(/cap/);
    expect(calls.some((c) => c.includes('/full'))).toBe(false);
    expect(await listReferences()).toEqual([]);
  });

  it('downloads at most 8 of 12 launches', async () => {
    const codes = Array.from({ length: 12 }, (_, i) => `LAUNCH${String(i).padStart(2, '0')}`);
    const statuses = Object.fromEntries(codes.map((c) => [c, 'ready']));
    const routes: Record<string, unknown> = {
      'GET /profiles/varunmayya/media?limit=30': { items: codes.map((c, i) => media(c, 'launch', `2026-10-21T0${i % 9}:00:00Z`)) },
      'POST /media/ensure': { statuses },
    };
    for (const c of codes) routes[`GET /media/${c}/full`] = 'MP4';
    const { deps, calls } = setup({ routes, launches: codes });
    const out = await runWatch(deps);
    expect(out.added).toHaveLength(8);
    expect(calls.filter((c) => c.endsWith('/full'))).toHaveLength(8);
  });

  it('does nothing while another run is under 2 hours old', async () => {
    await writeWatchState({ lastRunAt: new Date(NOW.getTime() - 3_600_000).toISOString(), lastDay: null, seen: [], skipped: null, running: true });
    const { deps, calls } = setup();
    const out = await runWatch(deps);
    expect(out.checked).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('maybeRunWatch', () => {
  it('does not start when today was already checked', async () => {
    await writeWatchState({ lastRunAt: NOW.toISOString(), lastDay: '2026-10-21', seen: [], skipped: null, running: false });
    const { deps, calls } = setup();
    expect(await maybeRunWatch(deps)).toBe(false);
    expect(calls).toEqual([]);
  });
  it('waits before retrying after a skip, then tries again the same day', async () => {
    await runWatch(setup({ routes: { 'GET /profiles': new Error('ECONNREFUSED') } }).deps);
    const soon = setup();
    expect(await maybeRunWatch(soon.deps)).toBe(false);
    const later = setup({ deps: { now: () => new Date(NOW.getTime() + 31 * 60_000) } });
    expect(await maybeRunWatch(later.deps)).toBe(true);
  });
  it('starts in the background when today has not been checked', async () => {
    const { deps } = setup();
    expect(await maybeRunWatch(deps)).toBe(true);
    await expect.poll(async () => (await readWatchState()).lastDay).toBe('2026-10-21');
  });
});
