import { getSettings } from '@/lib/settings';

/**
 * OpenRouter as a Runner: the same signature qwen and headless Claude already take, so a
 * stage that ran on either runs here by swapping one argument.
 *
 * Two things about it are stated rather than hidden. The key is never kept in the
 * settings file — it comes from OPENROUTER_API_KEY in the environment, and a missing one
 * is said plainly before any HTTP happens, because a 401 from a router reads like the
 * model's fault. And it is toolless as far as the studio is concerned: nothing here
 * accepts `allowedTools` or `onTool`, and `thinker()` turns away the stages that need
 * them rather than letting them answer from memory.
 */
export type OpenRouterOptions = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
};

type Reply = { choices?: { message?: { content?: string } }[] };

export function openrouterRunner(opts: OpenRouterOptions = {}) {
  return async (prompt: string, run: { timeoutMs?: number } = {}): Promise<string> => {
    const s = getSettings();
    const key = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error(
        'OPENROUTER_API_KEY is not set. The studio is on the OpenRouter provider, and the key is read from the environment rather than from the settings file.'
      );
    }
    const root = opts.baseUrl ?? s.openrouterUrl;
    const base = root.endsWith('/') ? root.slice(0, -1) : root;
    const model = opts.model ?? s.openrouterModel;
    const timeoutMs = run.timeoutMs ?? opts.timeoutMs ?? 600_000;

    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // What OpenRouter attributes the call to on its own dashboard.
        'http-referer': 'http://localhost:3120',
        'x-title': 'iolar studio',
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`OpenRouter refused ${model}: ${r.status} ${detail.slice(0, 300)}`);
    }
    const body = (await r.json()) as Reply;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`OpenRouter answered for ${model} with no message content`);
    }
    return content;
  };
}
