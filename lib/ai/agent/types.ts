import type { CommandInput } from '@/lib/reel/commands';
import type { Reel } from '@/lib/reel/schema';

/**
 * One interface over every brain, so the panel and the apply path never learn
 * which one answered.
 */

export type AgentRequest = { slug: string; reel: Reel; prompt: string };

export type AgentProposal = {
  commands: CommandInput[];
  /** What the agent says about the plan, if anything. */
  note?: string;
  /** Whatever came back verbatim, kept so an unparseable reply can be shown. */
  raw?: string;
};

export type AgentBackend = {
  name: 'local' | 'claude';
  propose(req: AgentRequest): Promise<AgentProposal>;
};

/**
 * Errors an operator can act on: each says what failed and what to do about it.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 503
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
