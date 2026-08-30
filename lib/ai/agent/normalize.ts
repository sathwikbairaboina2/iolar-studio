import type { CommandInput } from '@/lib/reel/commands';
import { toolNameToOp } from './tools';

/**
 * Turns whatever a model actually returned into commands.
 *
 * Models disagree about how to emit a tool call. When probed with the same
 * request, lfm2.5 and gemma4:12b returned real `tool_calls`, while
 * qwen2.5-coder:14b returned a JSON array in `content` and no tool_calls at all
 * — and its values were the correct ones. Accepting both shapes is what lets
 * `agentModel` stay a setting instead of a code change.
 *
 * Anything unrecognised yields no command rather than a guess. A model that
 * produced prose, or that was cut off mid-thought by a small `num_predict`,
 * must read as "proposed nothing", never as a malformed edit.
 */

export type RawMessage = {
  tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  content?: string;
};

type RawCall = { name: string; arguments: unknown };

function asObject(args: unknown): Record<string, unknown> | null {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
}

/** Pulls the first JSON array out of free text, fenced or bare. */
function arrayFromContent(content: string): RawCall[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidates = [fenced?.[1], content].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed as RawCall[];
    } catch {
      // Truncated or not JSON after all; try the next candidate.
    }
  }
  return null;
}

export function normaliseToolCalls(message: RawMessage): CommandInput[] {
  const fromTools = message.tool_calls
    ?.map((c) => ({ name: c.function?.name ?? '', arguments: c.function?.arguments }))
    .filter((c) => c.name);

  // Real tool_calls win: a model that sent both meant the structured one.
  const raw = fromTools?.length ? fromTools : (message.content ? arrayFromContent(message.content) : null);
  if (!raw) return [];

  const commands: CommandInput[] = [];
  for (const call of raw) {
    const op = toolNameToOp(String(call?.name ?? ''));
    const args = asObject(call?.arguments);
    // A tool that does not exist is dropped rather than turned into an op; the
    // command layer would reject it anyway, and silence is the honest answer.
    if (!op || !args) continue;
    commands.push({ op, args, actor: 'agent' });
  }
  return commands;
}
