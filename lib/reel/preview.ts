import { applyOne, CommandError, loadReelOr404, type CommandInput } from './commands';
import type { Reel } from './schema';

/**
 * Answers "what would this plan do?" without doing any of it.
 *
 * This is how an agent's proposal is checked before a human ever sees it, and
 * how the studio renders a diff. It runs the same validation the real write path
 * runs — the two share `applyOne` precisely so they cannot disagree — but it
 * saves nothing, publishes nothing and logs nothing.
 */

export type PreviewApplied = { index: number; op: string; summary: string };
export type PreviewRejected = { index: number; op: string; error: string; detail: unknown };

export type Preview = {
  /** The reel as it would stand, reflecting only the commands that applied. */
  reel: Reel;
  applied: PreviewApplied[];
  rejected: PreviewRejected[];
};

export async function previewCommands(slug: string, commands: CommandInput[]): Promise<Preview> {
  let reel = await loadReelOr404(slug);
  const applied: PreviewApplied[] = [];
  const rejected: PreviewRejected[] = [];

  commands.forEach((input, index) => {
    try {
      const out = applyOne(reel, input);
      reel = out.reel;
      applied.push({ index, op: out.op, summary: out.summary });
    } catch (err) {
      // Preview is diagnostic, so it keeps going: an agent on a revision budget
      // should learn every problem with its plan in one pass, not one per turn.
      // Apply stops at the first rejection instead — but a proposal carrying any
      // rejection is never applied, so the two never disagree in practice.
      const detail = err instanceof CommandError ? err.detail : {};
      rejected.push({ index, op: input.op, error: err instanceof Error ? err.message : String(err), detail });
    }
  });

  return { reel, applied, rejected };
}
