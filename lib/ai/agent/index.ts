import { provider } from '@/lib/ai/runner';
import { localBackend } from './local';
import { claudeBackend } from './claude';
import type { AgentBackend } from './types';

export * from './types';
export { agentTools, opToToolName, toolNameToOp } from './tools';
export { normaliseToolCalls } from './normalize';
export { reelSummary } from './summary';

/**
 * Which brain is driving. The studio's one provider switch, one interface, no other
 * difference — except that the agent is the one stage the switch cannot fully serve.
 * Both backends here call tools, headless Claude and an ollama, and OpenRouter is
 * neither: it is turned away rather than quietly sent to the local model it was chosen
 * instead of.
 */
export function getAgentBackend(): AgentBackend {
  const driving = provider();
  if (driving === 'openrouter') {
    throw new Error(
      'the reel agent needs Claude or the local model — it calls tools, and the OpenRouter provider has no tool-calling backend here. Switch the provider in Settings to use the agent.'
    );
  }
  return driving === 'claude' ? claudeBackend() : localBackend();
}
