import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

type Reply = { status?: number; body?: unknown; bytes?: Uint8Array; fail?: boolean };
const fake = (routes: Record<string, Reply>) => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    const r = routes[key ?? ''] ?? { status: 404, body: { detail: 'no route' } };
    if (r.fail) throw new Error('connect ECONNREFUSED');
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

const template = {
  name: 'tools', displayName: 'Tools', sections: ['hook', 'slides', 'web', 'cta'], required: ['hook', 'cta'],
  defaults: { hook: 10, slide: 6, page: 4, cta: 5 },
  limits: { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 },
  themes: ['kinetic'], samples: {},
};

describe('templates service client', () => {
  beforeEach(() => vi.resetModules());

  it('lists templates and caches them for a minute per base', async () => {
    const S = await import('@/lib/templates/service');
    const { f, calls } = fake({ '/templates': { body: { templates: [template] } } });
    let now = 1000;
    const opts = { baseUrl: 'http://x', fetchImpl: f, now: () => now };
    expect((await S.templates(opts))[0].limits.title).toBe(60);
    await S.templates(opts);
    expect(calls.length).toBe(1);
    now += 61_000;
    await S.templates(opts);
    expect(calls.length).toBe(2);
  });

  it('turns a 422 from validate into field issues', async () => {
    const S = await import('@/lib/templates/service');
    const { f } = fake({ '/validate': { status: 422, body: { detail: [{ loc: ['body', 'sections', 0, 'hook', 'title'], msg: 'String should have at most 60 characters', type: 'string_too_long' }] } } });
    await expect(S.validate({}, { baseUrl: 'http://x', fetchImpl: f })).rejects.toMatchObject({
      issues: [{ loc: ['sections', 0, 'hook', 'title'], msg: 'String should have at most 60 characters' }],
    });
  });

  it('submits, polls, and downloads the reel', async () => {
    const S = await import('@/lib/templates/service');
    const dir = mkdtempSync(path.join(tmpdir(), 'svc-'));
    const { f, calls } = fake({
      '/jobs': { status: 202, body: { id: 'j1' } },
      '/jobs/j1': { body: { state: 'done', progress: 1, error: null, timeline: { durationSec: 12 } } },
      '/jobs/j1/reel.mp4': { bytes: new TextEncoder().encode('mp4!') },
    });
    const opts = { baseUrl: 'http://x', fetchImpl: f };
    expect(await S.submit({ template: 'tools' }, opts)).toEqual({ id: 'j1' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://x/jobs' });
    expect((await S.job('j1', opts)).state).toBe('done');
    await S.download('j1', path.join(dir, 'reel.mp4'), opts);
    expect(readFileSync(path.join(dir, 'reel.mp4'), 'utf8')).toBe('mp4!');
  });

  it('names the base when the service is down, and builds the preview url', async () => {
    const S = await import('@/lib/templates/service');
    const { f } = fake({ '/templates': { fail: true } });
    await expect(S.templates({ baseUrl: 'http://x', fetchImpl: f })).rejects.toThrow(/http:\/\/x/);
    expect(S.previewUrl('tools', 'kinetic', 'j1', 'http://x')).toBe('http://x/preview/tools/kinetic?job=j1');
    expect(S.previewUrl('tools', 'kinetic', undefined, 'http://x')).toBe('http://x/preview/tools/kinetic');
  });
});
