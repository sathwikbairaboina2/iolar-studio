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

/**
 * Unload every model the research ollama is holding. `reason` is what the log says the
 * VRAM is wanted for — a ComfyUI render, or the thinking moving to Claude.
 */
export async function freeOllama(opts: GpuOpts, reason: string): Promise<string[]> {
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
    logPlugin('research', `${reason}; ollama at ${base} not answering (${String(err instanceof Error ? err.message : err).slice(0, 60)}), so it holds no VRAM`, 'warning');
    return [];
  }

  if (loaded.length === 0) {
    logPlugin('research', `${reason}; ollama at ${base} has nothing loaded, GPU is free`, 'info');
    return [];
  }

  const freed: string[] = [];
  for (const m of loaded) {
    const held = m.size_vram ? ` (${gb(m.size_vram)})` : '';
    logPlugin('research', `${reason}: unloading ${m.name}${held} from ollama at ${base}`, 'warning');
    try {
      const r = await http(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: timeout(),
      });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      freed.push(m.name);
      logPlugin('research', `freed ${m.name}; it reloads on the next local call`, 'success');
    } catch (err) {
      logPlugin('research', `could not unload ${m.name}: ${String(err instanceof Error ? err.message : err).slice(0, 80)}`, 'error');
    }
  }
  return freed;
}

/** Before any ComfyUI job: the card is one card, and a render needs most of it back. */
export async function yieldGpuToComfy(opts: GpuOpts): Promise<string[]> {
  return freeOllama(opts, 'ComfyUI render coming');
}
