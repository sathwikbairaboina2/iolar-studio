import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * One switch decides who thinks. These hold it to that: every stage reads the same
 * setting, the three legacy keys never disagree with it, and moving the studio to Claude
 * takes the local model off the card rather than leaving it resident.
 */

const settingsFile = () => path.join(process.env.IOLAR_DATA_DIR as string, 'settings.json');

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-llm-'));
  vi.resetModules();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe('the provider switch', () => {
  it('is local until it is turned, and answers through the legacy keys too', async () => {
    const { provider } = await import('@/lib/ai/runner');
    expect(provider()).toBe('local');

    const { saveSettings } = await import('@/lib/settings');
    const saved = saveSettings({ llmProvider: 'claude' });
    // The two older keys are the same decision, so they move with it.
    expect(saved).toMatchObject({ llmProvider: 'claude', researchProvider: 'claude', agentProvider: 'claude' });
    expect(provider()).toBe('claude');
  });

  it('reads a settings file written before the switch existed', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ researchProvider: 'claude' }));
    const { provider } = await import('@/lib/ai/runner');
    expect(provider()).toBe('claude');
    expect((await import('@/lib/settings')).getSettings().llmProvider).toBe('claude');
  });

  it('still takes a save that names only one of the older keys', async () => {
    const { saveSettings, getSettings } = await import('@/lib/settings');
    saveSettings({ llmProvider: 'claude' });
    // What the reel agent's own tests do: hand back the whole settings object, one key moved.
    const saved = saveSettings({ ...getSettings(), agentProvider: 'local' });
    expect(saved).toMatchObject({ llmProvider: 'local', researchProvider: 'local', agentProvider: 'local' });
  });

  it('sends the reel agent to the same brain as everything else', async () => {
    const { saveSettings } = await import('@/lib/settings');
    const { getAgentBackend } = await import('@/lib/ai/agent');
    expect(getAgentBackend().name).toBe('local');
    saveSettings({ llmProvider: 'claude' });
    expect(getAgentBackend().name).toBe('claude');
  });

  it('refuses a stage that needs the web while the provider is local', async () => {
    const { thinker, NoLocalToolsError } = await import('@/lib/ai/runner');
    await expect(thinker({ needsTools: 'the hunt' })('anything')).rejects.toBeInstanceOf(NoLocalToolsError);
  });

  it('takes the local model off the card when the studio moves to Claude', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      // One host ollama holds both models: the stages think on one, the reel agent on the other.
      if (String(url).endsWith('/api/ps')) {
        const models = [
          { name: 'qwen3.8:27b', size_vram: 17_399_734_598 },
          { name: 'lfm2.5', size_vram: 2_100_000_000 },
        ];
        return { ok: true, json: async () => ({ models }) } as Response;
      }
      if (String(url).endsWith('/api/llm')) return { ok: true, json: async () => ({ residency: 'transient', freed: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });

    const { PUT } = await import('@/app/api/settings/route');
    const put = (body: unknown) =>
      new Request('http://t/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const moved = await (await PUT(put({ llmProvider: 'claude' }))).json();
    expect(moved.freed).toEqual(['qwen3.8:27b', 'lfm2.5']);
    // The research service pins the model for its own runs, so it is told which way it went.
    expect(moved.toldResearch).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/api/llm'))?.body).toEqual({ provider: 'claude' });
    expect(calls.find((c) => c.url.endsWith('/api/generate'))?.body).toMatchObject({ model: 'qwen3.8:27b', keep_alive: 0 });

    // Saving again without moving the switch asks the card for nothing.
    calls.length = 0;
    const again = await (await PUT(put({ llmProvider: 'claude' }))).json();
    expect(again.freed).toEqual([]);
    expect(calls).toHaveLength(0);

    // And moving back to local leaves the card alone; the model loads on the next call,
    // and the research service is told it may pin it again.
    calls.length = 0;
    const back = await (await PUT(put({ llmProvider: 'local' }))).json();
    expect(back.freed).toEqual([]);
    expect(calls.find((c) => c.url.endsWith('/api/llm'))?.body).toEqual({ provider: 'local' });
    expect(calls.some((c) => c.url.endsWith('/api/generate'))).toBe(false);
  });
});

/**
 * OpenRouter is the third way to think: remote like Claude, toolless like the local model.
 * These hold it to both halves of that — it answers over HTTP with a key from the
 * environment, and it refuses the stages that genuinely need the web instead of guessing.
 */
describe('the provider switch, on OpenRouter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is one more position on the same switch, and the legacy keys move with it', async () => {
    const { saveSettings } = await import('@/lib/settings');
    const saved = saveSettings({ llmProvider: 'openrouter' });
    expect(saved).toMatchObject({
      llmProvider: 'openrouter',
      researchProvider: 'openrouter',
      agentProvider: 'openrouter',
    });
    const { provider } = await import('@/lib/ai/runner');
    expect(provider()).toBe('openrouter');
  });

  it('asks OpenRouter for the answer, with the key from the environment', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      } as Response;
    });

    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ llmProvider: 'openrouter', openrouterModel: 'meta-llama/llama-3.3-70b-instruct' });
    const { thinker } = await import('@/lib/ai/runner');
    const answer = await thinker()('write me a page');

    expect(answer).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.authorization ?? calls[0].headers.Authorization).toBe('Bearer sk-or-test');
    expect(calls[0].body).toMatchObject({
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'write me a page' }],
    });
  });

  it('says plainly that the key is missing rather than failing at the HTTP layer', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch should not be reached without a key');
    });
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ llmProvider: 'openrouter' });
    const { thinker } = await import('@/lib/ai/runner');
    await expect(thinker()('anything')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('refuses a stage that needs the web, the same way the local model does', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ llmProvider: 'openrouter' });
    const { thinker, NoLocalToolsError } = await import('@/lib/ai/runner');
    await expect(thinker({ needsTools: 'the hunt' })('anything')).rejects.toBeInstanceOf(NoLocalToolsError);
  });

  it('turns the reel agent away, because neither backend is OpenRouter', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ llmProvider: 'openrouter' });
    const { getAgentBackend } = await import('@/lib/ai/agent');
    expect(() => getAgentBackend()).toThrow(/reel agent/i);
  });

  it('takes the local model off the card, because the thinking left this machine', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith('/api/ps')) {
        return { ok: true, json: async () => ({ models: [{ name: 'qwen3.8:27b', size_vram: 17_399_734_598 }] }) } as Response;
      }
      if (String(url).endsWith('/api/llm')) return { ok: true, json: async () => ({ freed: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });

    const { PUT } = await import('@/app/api/settings/route');
    const moved = await (
      await PUT(
        new Request('http://t/api/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ llmProvider: 'openrouter' }),
        })
      )
    ).json();

    expect(moved.freed).toEqual(['qwen3.8:27b']);
    // The research service only knows two words, and the one that means "stop pinning" is claude.
    expect(calls.find((c) => c.url.endsWith('/api/llm'))?.body).toEqual({ provider: 'claude' });
  });
});
