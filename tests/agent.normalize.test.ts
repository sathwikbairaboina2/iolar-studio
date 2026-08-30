import { describe, it, expect } from 'vitest';

/**
 * Models disagree about how to emit a tool call. qwen2.5-coder returned a JSON
 * array in `content` where lfm2.5 and gemma4 returned real `tool_calls`, and all
 * three were otherwise usable. Normalising here is what makes `agentModel` a
 * setting rather than a code change.
 */

describe('normaliseToolCalls', () => {
  it('reads real tool_calls', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [
        { function: { name: 'clip_trim', arguments: { clipId: 'c3', edge: 'out', deltaSec: -0.5 } } },
        { function: { name: 'caption_nudge', arguments: { cueId: 'k2', deltaSec: -0.2 } } },
      ],
    });

    expect(out).toEqual([
      { op: 'clip.trim', args: { clipId: 'c3', edge: 'out', deltaSec: -0.5 }, actor: 'agent' },
      { op: 'caption.nudge', args: { cueId: 'k2', deltaSec: -0.2 }, actor: 'agent' },
    ]);
  });

  it('accepts arguments delivered as a JSON string', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [{ function: { name: 'clip_delete', arguments: '{"clipId":"c1"}' } }],
    });

    expect(out).toEqual([{ op: 'clip.delete', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  // What qwen2.5-coder:14b actually returned when probed.
  it('falls back to a JSON array left in content', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      content: `[
    {"name": "clip_trim", "arguments": {"clipId": "c3", "edge": "out", "deltaSec": -0.5}},
    {"name": "caption_nudge", "arguments": {"cueId": "k2", "deltaSec": -0.2}}
]`,
    });

    expect(out).toEqual([
      { op: 'clip.trim', args: { clipId: 'c3', edge: 'out', deltaSec: -0.5 }, actor: 'agent' },
      { op: 'caption.nudge', args: { cueId: 'k2', deltaSec: -0.2 }, actor: 'agent' },
    ]);
  });

  it('finds a JSON array wrapped in a fenced code block', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      content: 'Here is the plan:\n```json\n[{"name":"clip_delete","arguments":{"clipId":"c1"}}]\n```\nDone.',
    });

    expect(out).toEqual([{ op: 'clip.delete', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  it('prefers real tool_calls when a model sends both', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [{ function: { name: 'clip_delete', arguments: { clipId: 'c1' } } }],
      content: '[{"name":"caption_toggle","arguments":{"cueId":"k1"}}]',
    });

    expect(out).toEqual([{ op: 'clip.delete', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  it('drops a call naming a tool that does not exist rather than inventing an op', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [
        { function: { name: 'clip_explode', arguments: {} } },
        { function: { name: 'clip_delete', arguments: { clipId: 'c1' } } },
      ],
    });

    expect(out).toEqual([{ op: 'clip.delete', args: { clipId: 'c1' }, actor: 'agent' }]);
  });

  it('returns nothing for prose, rather than guessing', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    expect(normaliseToolCalls({ content: 'I think you should shorten clip c3 a bit.' })).toEqual([]);
  });

  it('returns nothing for an empty message', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    expect(normaliseToolCalls({})).toEqual([]);
  });

  // A thinking model starved of num_predict stops mid-thought; that must not throw.
  it('survives truncated output', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    expect(normaliseToolCalls({ content: '<think>\nOkay, let me see. Clip c3 is' })).toEqual([]);
    expect(normaliseToolCalls({ content: '[{"name":"clip_trim","argum' })).toEqual([]);
  });
});
