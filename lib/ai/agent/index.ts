import { provider } from '@/lib/ai/runner';
import { localBackend } from './local';
import { claudeBackend } from './claude';
import type { AgentBackend } from './types';

export * from './types';
export { agentTools, opToToolName, toolNameToOp } from './tools';
export { normaliseToolCalls } from './normalize';
export { reelSummary } from './summary';

/** Which brain is driving. The studio's one provider switch, one interface, no other difference. */
export function getAgentBackend(): AgentBackend {
  return provider() === 'claude' ? claudeBackend() : localBackend();
}
