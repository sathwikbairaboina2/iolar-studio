import { runClaude, ClaudeUnavailableError } from '../claude';
import { agentTools } from './tools';
import { normaliseToolCalls } from './normalize';
import { AgentError, type AgentBackend, type AgentProposal, type AgentRequest } from './types';
import { reelSummary } from './summary';

/**
 * The other brain: the Claude CLI already used for planning.
 *
 * It has no tool-calling channel here — `runClaude` returns text — so it is
 * asked for the JSON array shape the normalizer already accepts, which is the
 * same shape qwen2.5-coder produced unprompted.
 */
export function claudeBackend(): AgentBackend {
  return {
    name: 'claude',
    async propose(req: AgentRequest): Promise<AgentProposal> {
      const prompt = [
        'You are editing a short-form video reel. Reply with ONLY a JSON array of the edits to make.',
        'Each element is {"name": "<tool>", "arguments": {...}}. Reply with [] if nothing should change.',
        'No prose, no code fence, no explanation.',
        '',
        'Available tools:',
        JSON.stringify(agentTools().map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })), null, 1),
        '',
        'The reel:',
        JSON.stringify(reelSummary(req.reel), null, 1),
        '',
        'The request:',
        req.prompt,
      ].join('\n');

      let raw: string;
      try {
        raw = await runClaude(prompt, { timeoutMs: 120_000 });
      } catch (err) {
        if (err instanceof ClaudeUnavailableError) {
          throw new AgentError(
            'The Claude CLI is not on PATH. Install Claude Code, or switch agentProvider to "local" in Settings.'
          );
        }
        throw new AgentError(err instanceof Error ? err.message : String(err));
      }

      return { commands: normaliseToolCalls({ content: raw }), raw };
    },
  };
}
