import { logPlugin } from './log';

/**
 * One card, two tenants.
 *
 * qwen3.8:27b sits in 16 GB of the 24 GB card while the research ollama holds it, and a
 * lipsync render needs most of that back. Ollama drops a model the moment it is asked to
 * with keep_alive 0, so before any job goes to ComfyUI every model the research ollama is
 * holding is unloaded. The next research call loads it again, half a minute later.
 *
 * Nothing here may stop a render: an ollama that is down is an ollama holding no VRAM.
 */

export type GpuOpts = { ollamaUrl: string; fetchImpl?: typeof fetch };

type Loaded = { name: string; size_vram?: number };

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export async function yieldGpuToComfy(opts: GpuOpts): Promise<string[]> {
  const base = opts.ollamaUrl.replace(/\/$/, '');
  const http = opts.fetchImpl ?? fetch;
  const timeout = () => AbortSignal.timeout(8000);

  let loaded: Loaded[];
  try {
    const r = await http(`${base}/api/ps`, { cache: 'no-store', signal: timeout() });
    if (!r.ok) throw new Error(`answered ${r.status}`);
    const body = (await r.json()) as { models?: Loaded[] };
    loaded = Array.isArray(body.models) ? body.models : [];
  } catch (err) {
    logPlugin('research', `ComfyUI render coming; research-ollama not answering (${String(err instanceof Error ? err.message : err).slice(0, 60)}), so it holds no VRAM`, 'warning');
    return [];
  }

  if (loaded.length === 0) {
    logPlugin('research', 'ComfyUI render coming; research-ollama has nothing loaded, GPU is free', 'info');
    return [];
  }

  const freed: string[] = [];
  for (const m of loaded) {
    const held = m.size_vram ? ` (${gb(m.size_vram)})` : '';
    logPlugin('research', `ComfyUI render coming: unloading ${m.name}${held} from research-ollama`, 'warning');
    try {
      const r = await http(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: timeout(),
      });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      freed.push(m.name);
      logPlugin('research', `freed ${m.name}; it reloads on the next research call`, 'success');
    } catch (err) {
      logPlugin('research', `could not unload ${m.name}: ${String(err instanceof Error ? err.message : err).slice(0, 80)}`, 'error');
    }
  }
  return freed;
}
