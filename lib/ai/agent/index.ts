import { getSettings } from '@/lib/settings';
import { localBackend } from './local';
import { claudeBackend } from './claude';
import type { AgentBackend } from './types';

export * from './types';
export { agentTools, opToToolName, toolNameToOp } from './tools';
export { normaliseToolCalls } from './normalize';
export { reelSummary } from './summary';

/** Which brain is driving. One setting, one interface, no other difference. */
export function getAgentBackend(): AgentBackend {
  return getSettings().agentProvider === 'claude' ? claudeBackend() : localBackend();
}
