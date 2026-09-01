import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The studio depends on four services it does not own, and today the only way to know one is
 * down is a shot that never renders. Health is read as sub-checks rather than a single dot:
 * the lipsync API answers 200 while ComfyUI is unreachable and its models are missing, so the
 * summary is the one thing that cannot be trusted.
 */

beforeEach(() => vi.resetModules());

function mockFetch(routes: Record<string, { status?: number; body?: unknown; fail?: boolean }>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error(`unexpected fetch ${u}`);
    const r = routes[key];
    if (r.fail) throw new Error('connect ECONNREFUSED');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
  });
}

describe('the plugin registry', () => {
  it('knows every service the studio renders through', async () => {
    const { PLUGINS } = await import('@/lib/plugins/registry');
    expect(PLUGINS.map((p) => p.name).sort()).toEqual(['comfyui', 'lipsync', 'ollama', 'webpage']);
    for (const p of PLUGINS) {
      expect(p.port).toBeGreaterThan(0);
      expect(p.healthUrl).toContain(String(p.port));
      expect(p.what.length).toBeGreaterThan(10);
    }
  });

  it('carries paths a person could type, not ones an escape ate', async () => {
    const { PLUGINS } = await import('@/lib/plugins/registry');
    for (const p of PLUGINS.filter((x) => x.start)) {
      // A Windows path written with single backslashes in a TS string silently loses them:
      // 'C:\Users\me' becomes 'C:Usersme', the cwd stops existing, and the spawn fails
      // pointing at a directory nobody recognises.
      expect(p.start!.cwd).toMatch(/projects[\/\\]/);
      expect(p.start!.hint).not.toMatch(/scriptsserve/);
    }
    expect(PLUGINS.find((p) => p.name === 'lipsync')!.start!.hint).toContain('serve.ps1');
  });

  it('only offers to start the services it can start', async () => {
    const { PLUGINS } = await import('@/lib/plugins/registry');
    const startable = PLUGINS.filter((p) => p.start);
    expect(startable.map((p) => p.name).sort()).toEqual(['lipsync', 'webpage']);
    // ComfyUI Desktop is an app the user launches; pretending otherwise offers a button that lies.
    expect(PLUGINS.find((p) => p.name === 'comfyui')!.start).toBeUndefined();
  });
});

describe('reading health', () => {
  it('reports the lipsync sub-checks separately, not just its status code', async () => {
    mockFetch({
      ':8300': {
        body: {
          ok: false,
          checks: {
            database: { ok: true, jobs: 309 },
            redis: { ok: true },
            worker: { ok: true, workers: 1 },
            comfyui: { ok: false, error: 'connection refused' },
            models: { ok: false, missing: ['vae/wan_2.1_vae.safetensors'] },
          },
        },
      },
      ':8080': { body: { ok: true } },
      ':8189': { body: { system: {} } },
      ':11436': { body: { models: [] } },
    });
    const { readHealth } = await import('@/lib/plugins/health');

    const lip = (await readHealth()).find((p) => p.name === 'lipsync')!;

    expect(lip.up).toBe(true);
    // Answering is not the same as being able to render.
    expect(lip.ready).toBe(false);
    expect(lip.checks).toEqual(
      expect.arrayContaining([
        { label: 'redis', ok: true },
        { label: 'worker 1', ok: true },
        { label: 'comfyui', ok: false, detail: 'connection refused' },
        { label: 'models', ok: false, detail: '1 missing' },
      ])
    );
  });

  it('marks a service that will not answer as down', async () => {
    mockFetch({ ':8300': { fail: true }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} } });
    const { readHealth } = await import('@/lib/plugins/health');

    const lip = (await readHealth()).find((p) => p.name === 'lipsync')!;
    expect(lip).toMatchObject({ up: false, ready: false });
    expect(lip.error).toMatch(/ECONNREFUSED|refused/i);
  });

  it('counts the models ComfyUI is actually holding', async () => {
    mockFetch({
      ':8189': { body: { system: { comfyui_version: '0.34.2' }, devices: [{ name: 'cuda:0 RTX 4090' }] } },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':11436': { body: { models: [{ name: 'lfm2.5:latest' }] } },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const all = await readHealth();

    expect(all.find((p) => p.name === 'comfyui')).toMatchObject({ up: true, ready: true, version: '0.34.2' });
    expect(all.find((p) => p.name === 'ollama')!.checks).toEqual([{ label: '1 model', ok: true }]);
  });

  it('asks every service at once rather than one after another', async () => {
    const started: number[] = [];
    vi.stubGlobal('fetch', async () => {
      started.push(Date.now());
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    const { readHealth } = await import('@/lib/plugins/health');

    const began = Date.now();
    await readHealth();
    // Four sequential 30ms probes would take 120ms; a page that refreshes every few seconds
    // cannot spend that on a service that is merely slow.
    expect(Date.now() - began).toBeLessThan(100);
  });
});
