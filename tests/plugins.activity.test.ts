import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The GPU is one card shared by qwen and ComfyUI, and it cannot hold both. Yielding it is a
 * thing that happens on the server, invisibly — so every step writes to a log the pages can
 * show, and the studio never says "rendering" while it is secretly waiting on an unload.
 */

beforeEach(() => vi.resetModules());

type Call = { url: string; body?: unknown };

function mockFetch(routes: Record<string, { status?: number; body?: unknown; fail?: boolean }>, calls: Call[] = []) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error(`unexpected fetch ${u}`);
    const r = routes[key];
    if (r.fail) throw new Error('connect ECONNREFUSED');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  });
  return calls;
}

describe('the plugin activity log', () => {
  it('keeps what happened, newest last, and hands back only what a reader has not seen', async () => {
    const { logPlugin, readLog } = await import('@/lib/plugins/log');
    const a = logPlugin('research', 'starting');
    const b = logPlugin('research', 'up on :25100', 'success');
    expect(readLog().entries.map((e) => e.text)).toEqual(['starting', 'up on :25100']);
    expect(readLog(a.id).entries.map((e) => e.text)).toEqual(['up on :25100']);
    expect(readLog(b.id).entries).toEqual([]);
    expect(b).toMatchObject({ plugin: 'research', level: 'success' });
    expect(typeof b.at).toBe('string');
  });

  it('forgets the oldest lines rather than growing forever', async () => {
    const { logPlugin, readLog, LOG_LIMIT } = await import('@/lib/plugins/log');
    for (let i = 0; i < LOG_LIMIT + 5; i++) logPlugin('ollama', `line ${i}`);
    const { entries } = readLog();
    expect(entries.length).toBe(LOG_LIMIT);
    expect(entries[0].text).toBe('line 5');
  });
});

describe('yielding the GPU to ComfyUI', () => {
  it('unloads every model research-ollama is holding, and says so', async () => {
    const calls = mockFetch({
      '/api/ps': { body: { models: [{ name: 'qwen3.8:27b', size_vram: 17399734598 }] } },
      '/api/generate': { body: { done: true } },
    });
    const { yieldGpuToComfy } = await import('@/lib/plugins/gpu');
    const { readLog } = await import('@/lib/plugins/log');

    const freed = await yieldGpuToComfy({ ollamaUrl: 'http://127.0.0.1:25103' });

    expect(freed).toEqual(['qwen3.8:27b']);
    const unload = calls.find((c) => c.url.includes('/api/generate'));
    expect(unload?.body).toMatchObject({ model: 'qwen3.8:27b', keep_alive: 0 });
    const texts = readLog().entries.map((e) => e.text);
    expect(texts.some((t) => /unloading qwen3\.8:27b/.test(t) && /16\.2 GB/.test(t))).toBe(true);
    expect(texts.some((t) => /freed/.test(t))).toBe(true);
  });

  it('is a no-op that still explains itself when nothing is loaded', async () => {
    mockFetch({ '/api/ps': { body: { models: [] } } });
    const { yieldGpuToComfy } = await import('@/lib/plugins/gpu');
    const { readLog } = await import('@/lib/plugins/log');

    expect(await yieldGpuToComfy({ ollamaUrl: 'http://127.0.0.1:25103' })).toEqual([]);
    expect(readLog().entries.at(-1)?.text).toMatch(/nothing loaded/);
  });

  it('never blocks a render because research-ollama is down', async () => {
    mockFetch({ '/api/ps': { fail: true } });
    const { yieldGpuToComfy } = await import('@/lib/plugins/gpu');
    const { readLog } = await import('@/lib/plugins/log');

    await expect(yieldGpuToComfy({ ollamaUrl: 'http://127.0.0.1:25103' })).resolves.toEqual([]);
    expect(readLog().entries.at(-1)).toMatchObject({ level: 'warning' });
  });
});

describe('the lipsync provider', () => {
  it('yields the GPU before it posts a job to ComfyUI', async () => {
    const order: string[] = [];
    const calls = mockFetch({ '/jobs': { body: { id: 'j1', status: 'queued' } } });
    const { createLipsyncProvider } = await import('@/lib/reel/providers/lipsync');
    const p = createLipsyncProvider({
      baseUrl: 'http://127.0.0.1:8300',
      yieldGpu: async () => {
        order.push('yield');
        return ['qwen3.8:27b'];
      },
    });

    const job = await p.animate({ imagePath: 'C:/x/face.png', audioPath: 'C:/x/b1.wav', ratio: '9:16' } as never);

    expect(job).toBeTruthy();
    expect(order).toEqual(['yield']);
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:8300/jobs']);
  });
});

describe('health flips', () => {
  it('writes a line when a service comes up or goes down, and stays quiet otherwise', async () => {
    const up = { ':8300': { body: { ok: true, checks: {} } }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} }, ':26100': { body: { ok: true, weeks: 1 } }, ':25100': { body: { ollama: { ok: true, model: 'qwen3.8:27b' }, channels: [{ channel: 'searxng', ok: true }] } } };
    mockFetch(up);
    const { readHealth } = await import('@/lib/plugins/health');
    const { readLog } = await import('@/lib/plugins/log');

    await readHealth();
    const first = readLog().entries.length;
    await readHealth();
    expect(readLog().entries.length).toBe(first);

    // One missed poll is a slow health check, not an outage: the research service's own
    // check takes seconds and sometimes crosses the budget. Two in a row is the news.
    mockFetch({ ...up, ':25100': { fail: true } });
    await readHealth();
    expect(readLog().entries.length).toBe(first);
    await readHealth();
    const last = readLog().entries.at(-1);
    expect(last).toMatchObject({ plugin: 'research', level: 'error' });
    expect(last?.text).toMatch(/down/);

    mockFetch(up);
    await readHealth();
    await readHealth();
    expect(readLog().entries.at(-1)).toMatchObject({ plugin: 'research', level: 'success' });
  });

  it('survives a flip record left in an older shape by a dev reload', async () => {
    const up = { ':8300': { body: { ok: true, checks: {} } }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} }, ':26100': { body: { ok: true, weeks: 1 } }, ':25100': { body: { ollama: { ok: true, model: 'qwen3.8:27b' }, channels: [{ channel: 'searxng', ok: true }] } }, ':3125': { body: {} }, ':3126': { body: {} } };
    mockFetch(up);
    const g = globalThis as unknown as { __pluginLast?: Map<string, unknown> };
    g.__pluginLast = new Map([['research', { up: true, ready: true }]]);
    const { readHealth } = await import('@/lib/plugins/health');
    await expect(readHealth()).resolves.toHaveLength(8);
  });

  it('stays quiet through a single timed-out poll', async () => {
    const up = { ':8300': { body: { ok: true, checks: {} } }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} }, ':26100': { body: { ok: true, weeks: 1 } }, ':25100': { body: { ollama: { ok: true, model: 'qwen3.8:27b' }, channels: [{ channel: 'searxng', ok: true }] } } };
    mockFetch(up);
    const { readHealth } = await import('@/lib/plugins/health');
    const { readLog } = await import('@/lib/plugins/log');
    await readHealth();
    const before = readLog().entries.length;

    mockFetch({ ...up, ':25100': { fail: true } });
    await readHealth();
    mockFetch(up);
    await readHealth();
    await readHealth();
    expect(readLog().entries.length).toBe(before);
  });
});
