import { getSettings } from '@/lib/settings';
import { COMMANDS, type CommandInput } from '@/lib/reel/commands';
import { agentTools } from './tools';
import { AgentError, type AgentBackend, type AgentProposal, type AgentRequest } from './types';

/**
 * Client for the LangGraph service in `agent/`.
 *
 * The service owns the loop — propose, preview, revise — because that loop is
 * the reason it exists at all; without it this would be one chat completion and
 * a prompt template. What comes back is a plan, never an applied edit.
 */

const REQUEST_TIMEOUT_MS = 120_000;

/** Whatever the service returns is re-checked here: it is a separate process. */
function sanitise(raw: unknown): CommandInput[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(Object.keys(COMMANDS));
  return raw
    .filter((c): c is { op: string; args: unknown } => !!c && typeof (c as { op?: unknown }).op === 'string')
    .filter((c) => valid.has(c.op))
    // The actor is decided here, not by the service. A proposal is an agent's
    // work no matter what the service labels it.
    .map((c) => ({ op: c.op, args: c.args ?? {}, actor: 'agent' as const }));
}

export function localBackend(): AgentBackend {
  return {
    name: 'local',
    async propose(req: AgentRequest): Promise<AgentProposal> {
      const s = getSettings();
      const url = `${s.agentUrl.replace(/\/$/, '')}/propose`;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: req.slug,
            prompt: req.prompt,
            reel: req.reel,
            tools: agentTools(),
            model: s.agentModel,
            ollamaUrl: s.agentOllamaUrl,
            numPredict: s.agentNumPredict,
            maxRevisions: s.agentMaxRevisions,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const why = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
        throw new AgentError(
          `The local agent at ${s.agentUrl} ${why}. Start it with \`docker compose -f agent/compose.yml up -d\`, ` +
            `or switch agentProvider to "claude" in Settings.`
        );
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The service knows more about Ollama than we do; show what it said.
        throw new AgentError(data.error ?? `The local agent answered ${res.status}.`, res.status);
      }

      return { commands: sanitise(data.commands), note: data.note, raw: data.raw };
    },
  };
}
