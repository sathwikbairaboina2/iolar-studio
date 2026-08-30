import type { Candidate } from './candidate';
import type { Script, ScriptLine } from './script';

/**
 * What the script review screen decides.
 *
 * Kept out of the component so it can be tested: this project has no
 * component-test stack, and these are the answers that matter — whether a line
 * lacks a source, whether the script may be approved, how long it will run.
 * The screen renders them; it does not work them out.
 */

/** Factual lines with nothing backing them. Commentary is exempt by definition. */
export function uncitedLines(lines: ScriptLine[]): string[] {
  return lines.filter((l) => !l.commentary && l.citations.length === 0).map((l) => l.id);
}

/** Roughly how long this will take to say — the thing you cannot judge by eye. */
export function spokenWordCount(lines: ScriptLine[]): number {
  return lines.reduce((total, l) => total + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
}

/**
 * Approval is refused for an uncited claim, never for an unproven brief claim.
 *
 * The first is the script asserting something the pack does not support. The
 * second means the research did not find what the brief hoped for, which is a
 * fact about the topic and the user's call to make.
 */
export function canApprove(script: Pick<Script, "lines" | "status">): boolean {
  if (script.status === "approved") return false;
  if (script.lines.length === 0) return false;
  return uncitedLines(script.lines).length === 0;
}

function renumber(lines: ScriptLine[]): ScriptLine[] {
  return lines.map((line, order) => ({ ...line, order }));
}

export function dropLine(lines: ScriptLine[], id: string): ScriptLine[] {
  return renumber(lines.filter((l) => l.id !== id));
}

export function reorderLines(lines: ScriptLine[], id: string, toIndex: number): ScriptLine[] {
  const from = lines.findIndex((l) => l.id === id);
  if (from < 0) return lines;
  const next = [...lines];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
  return renumber(next);
}

export type ResolvedCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  /** The candidate is gone — dropped in review after the line was written. */
  missing: boolean;
};

/**
 * Turns citation ids into something readable.
 *
 * A citation whose candidate no longer exists is surfaced as missing rather than
 * quietly skipped: the line still claims something, and the source it claimed it
 * from has left the pack.
 */
export function citationsFor(line: ScriptLine, candidates: Candidate[]): ResolvedCitation[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return line.citations.map((id) => {
    const found = byId.get(id);
    return found
      ? { id, title: found.title, publisher: found.publisher, url: found.url, missing: false }
      : { id, title: "source no longer in the pack", publisher: "—", url: null, missing: true };
  });
}
