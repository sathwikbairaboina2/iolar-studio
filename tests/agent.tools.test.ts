import { describe, it, expect } from 'vitest';

/**
 * The tool list a model is shown must be generated from the command registry,
 * never hand-written. Copying an enum by hand is exactly how `crossfade` became
 * `fade` during the command-layer build; the same slip in a tool schema would
 * look like the model hallucinating.
 */

describe('agent tool schemas', () => {
  it('offers exactly one tool per command', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');
    const { COMMANDS } = await import('@/lib/reel/commands');

    expect(agentTools()).toHaveLength(Object.keys(COMMANDS).length);
  });

  it('names tools with an underscore, since function schemas disallow dots', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');

    const names = agentTools().map((t) => t.function.name);

    expect(names).toContain('beat_text');
    expect(names.some((n) => n.includes('.'))).toBe(false);
  });

  it('maps a tool name back to the op it came from', async () => {
    const { toolNameToOp, opToToolName } = await import('@/lib/ai/agent/tools');

    expect(toolNameToOp('beat_text')).toBe('beat.text');
    expect(opToToolName('beat.text')).toBe('beat_text');
    expect(toolNameToOp('not_a_tool')).toBeNull();
  });

  it('carries the real argument schema, not a hand-written copy', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');

    const rewrite = agentTools().find((t) => t.function.name === 'beat_text')!;
    const props = rewrite.function.parameters.properties as Record<string, { enum?: string[] }>;

    // Straight off the command's own zod schema, so the two cannot drift apart.
    expect(Object.keys(props).sort()).toEqual(['beatId', 'text']);
  });

  it('gives every tool a description, since that is all the model has to go on', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');

    for (const t of agentTools()) {
      expect(t.function.description.length).toBeGreaterThan(10);
    }
  });
});
