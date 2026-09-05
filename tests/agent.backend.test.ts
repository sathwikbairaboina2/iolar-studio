import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Which brain runs is a setting. Everything above this layer — the panel, the
 * apply path — must not be able to tell which one answered.
 *
 * Failures matter as much as successes here: the first audience for these
 * messages is someone deciding what to restart.
 */

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-agent-'));
  vi.unstubAllGlobals();
});

async function setProvider(over: Record<string, unknown>) {
  const { saveSettings, getSettings } = await import('@/lib/settings');
  saveSettings({ ...getSettings(), ...over });
}

const reelStub = { title: 'Grok', timeline: { clips: [], captions: [], overlays: [] } } as never;
const req = { slug: 'grok', reel: reelStub, prompt: 'tighten the hook' };

describe('agent backend selection', () => {
  it('uses the local service when agentProvider is local', async () => {
    const { getAgentBackend } = await import('@/lib/ai/agent');
    await setProvider({ agentProvider: 'local' });

    expect(getAgentBackend().name).toBe('local');
  });

  it('uses Claude when agentProvider is claude', async () => {
    const { getAgentBackend } = await import('@/lib/ai/agent');
    await setProvider({ agentProvider: 'claude' });

    expect(getAgentBackend().name).toBe('claude');
  });

  it('defaults to local', async () => {
    const { getSettings } = await import('@/lib/settings');

    expect(getSettings().agentProvider).toBe('local');
  });
});

describe('local agent backend', () => {
  it('sends the prompt, the reel and the generated tools to the service', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init.body)) };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ commands: [{ op: 'beat.text', args: { clipId: 'c1' } }] }),
      } as Response);
    });

    const out = await localBackend().propose(req);

    expect(String(sent.url)).toMatch(/\/propose$/);
    const body = sent.body as { prompt: string; tools: unknown[]; model: string };
    expect(body.prompt).toBe('tighten the hook');
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.model).toBe('qwen3.8:27b');
    expect(out.commands).toEqual([{ op: 'beat.text', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  it('says which URL it could not reach when the container is down', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    vi.stubGlobal('fetch', () => Promise.reject(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })));

    const err = await localBackend().propose(req).catch((e) => e);

    expect(err.message).toMatch(/3121/);
    expect(err.message).toMatch(/agent\/compose\.yml/);
  });

  it('passes through the service diagnosis of a missing model', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'model "lfm2.5" not found on http://host.docker.internal:11436' }),
      } as Response)
    );

    const err = await localBackend().propose(req).catch((e) => e);

    expect(err.message).toMatch(/lfm2\.5/);
    expect(err.message).toMatch(/11436/);
  });

  it('treats a service reply with no commands as proposing nothing', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: 'nothing to do' }) } as Response)
    );

    const out = await localBackend().propose(req);

    expect(out.commands).toEqual([]);
    expect(out.note).toBe('nothing to do');
  });

  it('drops a command naming an op that does not exist', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            commands: [{ op: 'clip.explode', args: {} }, { op: 'beat.text', args: { clipId: 'c1' } }],
          }),
      } as Response)
    );

    const out = await localBackend().propose(req);

    expect(out.commands).toEqual([{ op: 'beat.text', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  it('forces actor to agent even if the service claims otherwise', async () => {
    const { localBackend } = await import('@/lib/ai/agent/local');
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ commands: [{ op: 'beat.text', args: { clipId: 'c1' }, actor: 'ui' }] }),
      } as Response)
    );

    const out = await localBackend().propose(req);

    expect(out.commands[0].actor).toBe('agent');
  });
});
