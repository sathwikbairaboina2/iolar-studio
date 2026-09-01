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
        { function: { name: 'beat_text', arguments: { beatId: 'b3', text: 'a rewritten line' } } },
        { function: { name: 'beat_text', arguments: { beatId: 'b4', text: 'a second rewritten line' } } },
      ],
    });

    expect(out).toEqual([
      { op: 'beat.text', args: { beatId: 'b3', text: 'a rewritten line' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b4', text: 'a second rewritten line' }, actor: 'agent' },
    ]);
  });

  it('accepts arguments delivered as a JSON string', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [{ function: { name: 'beat_text', arguments: '{"beatId":"b1","text":"a rewritten line"}' } }],
    });

    expect(out).toEqual([{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);
  });

  // What qwen2.5-coder:14b actually returned when probed.
  it('falls back to a JSON array left in content', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      content: `[
    {"name": "beat_text", "arguments": {"beatId": "b3", "text": "a rewritten line"}},
    {"name": "beat_text", "arguments": {"beatId": "b4", "text": "a second rewritten line"}}
]`,
    });

    expect(out).toEqual([
      { op: 'beat.text', args: { beatId: 'b3', text: 'a rewritten line' }, actor: 'agent' },
      { op: 'beat.text', args: { beatId: 'b4', text: 'a second rewritten line' }, actor: 'agent' },
    ]);
  });

  it('finds a JSON array wrapped in a fenced code block', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      content: 'Here is the plan:\n```json\n[{"name":"beat_text","arguments":{"beatId":"b1","text":"a rewritten line"}}]\n```\nDone.',
    });

    expect(out).toEqual([{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);
  });

  it('prefers real tool_calls when a model sends both', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [{ function: { name: 'beat_text', arguments: { beatId: 'b1', text: 'a rewritten line' } } }],
      content: '[{"name":"caption_toggle","arguments":{"cueId":"k1"}}]',
    });

    expect(out).toEqual([{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);
  });

  it('drops a call naming a tool that does not exist rather than inventing an op', async () => {
    const { normaliseToolCalls } = await import('@/lib/ai/agent/normalize');

    const out = normaliseToolCalls({
      tool_calls: [
        { function: { name: 'clip_explode', arguments: {} } },
        { function: { name: 'beat_text', arguments: { beatId: 'b1', text: 'a rewritten line' } } },
      ],
    });

    expect(out).toEqual([{ op: 'beat.text', args: { beatId: 'b1', text: 'a rewritten line' }, actor: 'agent' }]);
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
    expect(normaliseToolCalls({ content: '[{"name":"beat_text","argum' })).toEqual([]);
  });
});
