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

    expect(names).toContain('clip_trim');
    expect(names).toContain('caption_nudge');
    expect(names.some((n) => n.includes('.'))).toBe(false);
  });

  it('maps a tool name back to the op it came from', async () => {
    const { toolNameToOp, opToToolName } = await import('@/lib/ai/agent/tools');

    expect(toolNameToOp('clip_trim')).toBe('clip.trim');
    expect(opToToolName('caption.merge')).toBe('caption_merge');
    expect(toolNameToOp('not_a_tool')).toBeNull();
  });

  it('carries the real argument schema, not a hand-written copy', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');

    const trim = agentTools().find((t) => t.function.name === 'clip_trim')!;
    const props = trim.function.parameters.properties as Record<string, { enum?: string[] }>;

    expect(Object.keys(props).sort()).toEqual(['clipId', 'deltaSec', 'edge']);
    expect(props.edge.enum).toEqual(['in', 'out']);
  });

  it('takes the transition values from the schema, so they cannot drift', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');
    const { CLIP_TRANSITIONS } = await import('@/lib/reel/schema');

    const tool = agentTools().find((t) => t.function.name === 'clip_transition')!;
    const props = tool.function.parameters.properties as Record<string, { enum?: string[] }>;

    expect(props.transition.enum).toEqual([...CLIP_TRANSITIONS]);
  });

  it('gives every tool a description, since that is all the model has to go on', async () => {
    const { agentTools } = await import('@/lib/ai/agent/tools');

    for (const t of agentTools()) {
      expect(t.function.description.length).toBeGreaterThan(10);
    }
  });
});
