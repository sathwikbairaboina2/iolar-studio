import { getSettings, type Settings } from '@/lib/settings';
import { runClaude, type ToolCall } from './claude';
import { qwenRunner } from './qwen';
import { freeOllama } from '@/lib/plugins/gpu';

/**
 * One switch, one brain.
 *
 * Every stage that asks a model anything — the handbook planner, the reel writer, the
 * research hunt, the reel agent, the job card reader — asks through `thinker()`. What it
 * gets back is headless Claude or the local model on the research ollama, and which one
 * is the single setting the Settings page shows. Nothing else in the studio decides.
 *
 * The two are not equals and the difference is stated rather than hidden: Claude can be
 * given tools (`allowedTools`) and can be watched working (`onTool`); the local model
 * cannot, and quietly ignores both. A stage that genuinely needs the web says so by
 * passing `needsTools`, and on the local provider that is an error rather than a silently
 * worse answer.
 */

export type Runner = (
  prompt: string,
  opts?: { timeoutMs?: number; allowedTools?: string[]; onTool?: (call: ToolCall) => void }
) => Promise<string>;

export class NoLocalToolsError extends Error {
  constructor(what: string) {
    super(`${what} needs the web, and the local model has no tools. Switch the provider to Claude in Settings.`);
    this.name = 'NoLocalToolsError';
  }
}

/** Which brain is driving. Read through the legacy keys too, so a mocked settings object still answers. */
export function provider(s: Partial<Settings> = getSettings()): 'claude' | 'local' {
  return (s.llmProvider ?? s.researchProvider ?? s.agentProvider ?? 'local') === 'claude' ? 'claude' : 'local';
}

export const onClaude = () => provider() === 'claude';

/**
 * The model of the moment. `needsTools` names a stage that cannot work without the web —
 * it fails loudly on the local provider instead of answering from memory.
 */
export function thinker(opts: { needsTools?: string; timeoutMs?: number } = {}): Runner {
  if (provider() === 'claude') {
    return (prompt, run = {}) => runClaude(prompt, { timeoutMs: opts.timeoutMs, ...run });
  }
  if (opts.needsTools) {
    const err = new NoLocalToolsError(opts.needsTools);
    return () => Promise.reject(err);
  }
  const local = qwenRunner();
  return (prompt, run = {}) => local(prompt, { timeoutMs: run.timeoutMs ?? opts.timeoutMs });
}

/**
 * Nothing local should be holding the card once the thinking moved to Claude. Both the
 * ollama the stages think on and the one the reel agent uses are asked to drop what they
 * hold; ollama does that the moment it is asked with keep_alive 0, and the next local call
 * loads the model again half a minute later.
 *
 * The embedder is not touched. Claude has nothing to put in its place, so the knowledge
 * layer keeps working either way — and nomic holds a fraction of a gigabyte, not sixteen.
 */
export async function stopLocalModels(reason = 'the studio moved its thinking to Claude'): Promise<string[]> {
  const s = getSettings();
  const urls = [...new Set([s.researchOllamaUrl, s.agentOllamaUrl].filter(Boolean))];
  const freed: string[] = [];
  for (const ollamaUrl of urls) freed.push(...(await freeOllama({ ollamaUrl }, reason).catch(() => [])));
  return freed;
}

/**
 * The research service is a separate app with its own reasons to load the model — a
 * watchlist run, a digest, a job classified — and it pins the 27B for an hour between
 * them. Unloading behind its back only means it loads again, so it is told which way the
 * switch went: on Claude it stops pinning (every call loads and lets go), on local it
 * pins again. A service that is down changes nothing here — it is holding no VRAM.
 */
export async function tellResearchService(
  to: 'claude' | 'local',
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<{ told: boolean; freed: string[] }> {
  const http = opts.fetchImpl ?? fetch;
  const base = getSettings().researchUrl.replace(/\/$/, '');
  try {
    const r = await http(`${base}/api/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: to }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { told: false, freed: [] };
    const body = (await r.json()) as { freed?: string[] };
    return { told: true, freed: body.freed ?? [] };
  } catch {
    return { told: false, freed: [] };
  }
}
