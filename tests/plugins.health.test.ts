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
    expect(PLUGINS.map((p) => p.name).sort()).toEqual(['comfyui', 'jobsreel', 'lipsync', 'neo4j', 'ollama', 'qdrant', 'research', 'webpage']);
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

  it('starts the research service the one way it runs on this machine', async () => {
    const { PLUGINS } = await import('@/lib/plugins/registry');
    const research = PLUGINS.find((p) => p.name === 'research')!;
    expect(research.port).toBe(25100);
    expect(research.healthUrl).toBe('http://127.0.0.1:25100/api/health');
    // Turbopack is the build that works there; --webpack dies on node:crypto in instrumentation.
    expect(research.start!.hint).toContain('serve.ps1');
    expect(research.start!.args).toContain('scripts/serve.ps1');
    expect(research.start!.cwd).toMatch(/research-plugin$/);
    expect(research.openUrl).toBe('http://127.0.0.1:25100');
  });

  it('only offers to start the services it can start', async () => {
    const { PLUGINS } = await import('@/lib/plugins/registry');
    const startable = PLUGINS.filter((p) => p.start);
    expect(startable.map((p) => p.name).sort()).toEqual(['jobsreel', 'lipsync', 'neo4j', 'qdrant', 'research', 'webpage']);
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

  it('does not call the worker missing while it is busy rendering', async () => {
    // Celery's ping times out under a solo-pool render, so the API honestly reports zero
    // workers at the exact moment one is working. Saying "worker 0" there sends you
    // restarting a service that is mid-shot.
    mockFetch({
      ':8300': { body: { ok: false, checks: { redis: { ok: true }, worker: { ok: false, workers: 0 } } } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const { reconcile } = await import('@/lib/plugins/health');

    const raw = (await readHealth()).find((p) => p.name === 'lipsync')!;
    expect(raw.checks).toContainEqual({ label: 'worker 0', ok: false });

    const seen = reconcile([raw], [{ plugin: 'lipsync', status: 'running' }]).find((p) => p.name === 'lipsync')!;
    expect(seen.checks).toContainEqual({ label: 'worker busy', ok: true });
    expect(seen.ready).toBe(true);
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

  it('reads the research service channel by channel, with its model first', async () => {
    mockFetch({
      ':25100': {
        body: {
          ollama: { ok: true, baseUrl: 'http://127.0.0.1:25103', model: 'qwen3.8:27b', recovery: 'docker compose up -d research-ollama' },
          channels: [
            { channel: 'searxng', ok: true, detail: 'searxng json api on 25180' },
            { channel: 'web', ok: true, detail: 'jina reader' },
            { channel: 'youtube', ok: false, detail: 'yt-dlp not on PATH' },
          ],
        },
      },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const research = (await readHealth()).find((p) => p.name === 'research')!;

    expect(research.up).toBe(true);
    expect(research.checks[0]).toEqual({ label: 'qwen3.8:27b', ok: true });
    expect(research.checks).toContainEqual({ label: 'searxng', ok: true, detail: 'searxng json api on 25180' });
    expect(research.checks).toContainEqual({ label: 'youtube', ok: false, detail: 'yt-dlp not on PATH' });
    // A hunt needs the model and the search engine; a missing yt-dlp only loses one channel.
    expect(research.ready).toBe(true);
  });

  it('is not ready to hunt when its ollama is down, and says how to bring it back', async () => {
    mockFetch({
      ':25100': {
        body: {
          ollama: { ok: false, model: 'qwen3.8:27b', recovery: 'docker compose -f docker/compose.yml up -d research-ollama' },
          channels: [{ channel: 'searxng', ok: false, detail: 'connect ECONNREFUSED 127.0.0.1:25180' }],
        },
      },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const research = (await readHealth()).find((p) => p.name === 'research')!;

    expect(research).toMatchObject({ up: true, ready: false });
    expect(research.checks[0]).toEqual({
      label: 'qwen3.8:27b',
      ok: false,
      detail: 'docker compose -f docker/compose.yml up -d research-ollama',
    });
  });

  it('reads the jobs-reel board as weeks on disk', async () => {
    mockFetch({
      ':26100': { body: { ok: true, service: 'jobs-reel-plugin', weeks: 11 } },
      ':25100': { body: { ollama: { ok: true }, channels: [] } },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const jobs = (await readHealth()).find((p) => p.name === 'jobsreel')!;
    expect(jobs).toMatchObject({ up: true, ready: true, port: 26100 });
    expect(jobs.checks).toEqual([{ label: '11 weeks on disk', ok: true }]);
    expect(jobs.openUrl).toBe('http://127.0.0.1:26100');
    expect(jobs.startHint).toBe('npm run dev');
  });

  it('watches the two knowledge stores and can start either with compose', async () => {
    mockFetch({
      ':3125': { body: {} },
      ':3126': { status: 200, body: {} },
      ':26100': { body: { ok: true, weeks: 1 } },
      ':25100': { body: { ollama: { ok: true }, channels: [] } },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const all = await readHealth();
    const neo = all.find((p) => p.name === 'neo4j')!;
    const q = all.find((p) => p.name === 'qdrant')!;
    expect(neo).toMatchObject({ up: true, ready: true, port: 3125, startHint: 'docker compose -f docker/compose.yml up -d iolar-neo4j' });
    expect(q).toMatchObject({ up: true, ready: true, port: 3126, openUrl: 'http://127.0.0.1:3126/dashboard' });
  });

  it('shows how much the stores hold, so an empty graph is visible before an agent notices', async () => {
    vi.doMock('@/lib/knowledge/recall', () => ({ storeCounts: async () => ({ nodes: 1234, passages: 5600, claims: 41 }) }));
    mockFetch({
      ':3125': { body: {} },
      ':3126': { body: {} },
      ':26100': { body: { ok: true, weeks: 1 } },
      ':25100': { body: { ollama: { ok: true }, channels: [] } },
      ':8300': { body: { ok: true, checks: {} } },
      ':8080': { body: { ok: true } },
      ':8189': { body: {} },
      ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const all = await readHealth();
    expect(all.find((p) => p.name === 'neo4j')!.checks).toEqual([{ label: '1,234 nodes', ok: true }]);
    expect(all.find((p) => p.name === 'qdrant')!.checks).toEqual([{ label: '5,600 passages', ok: true }, { label: '41 claims', ok: true }]);
    vi.doUnmock('@/lib/knowledge/recall');
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
