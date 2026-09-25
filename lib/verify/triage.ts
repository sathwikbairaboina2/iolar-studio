import { createHash } from 'crypto';
import type { Finding } from './gates';

/**
 * A stable handle for one finding, used as the approval token.
 *
 * It is derived from the finding's content, never from its position in the review: the
 * campaign regenerates review.json, and a positional key would silently re-point at a
 * different finding between the listing a person read and the --apply they ran. Content
 * addressing makes a stale token fail to resolve, which is the safe direction — the person
 * is told the finding is gone rather than handed a rewrite they never approved.
 */
export function findingKey(f: Finding): string {
  return createHash('sha1')
    .update([f.pass, f.rule, f.page, f.summary].join('\u0000'))
    .digest('hex')
    .slice(0, 8);
}

/**
 * What may happen to a finding without a human in the loop.
 *
 * Cosmetic passes apply themselves. A factual or pedagogical finding rewrites what the
 * handbook teaches, and applying thousands of those unsupervised converts a countable
 * number of known errors into an uncountable number of new ones — so they are proposed and
 * approved one at a time. `code` and `coverage` are fixed deterministically by the gates
 * and the campaign, so a leftover there is a gate bug, not triage work.
 *
 * Nothing minor is acted on at all. That is what keeps a deterministic gate finding such as
 * `brand.handle` — a settings mismatch, always minor — from being sent to a language model
 * to fix a single field.
 */
export type Disposition = 'auto' | 'approve' | 'skip';

const COSMETIC = new Set(['visual', 'brand']);
const EDITORIAL = new Set(['facts', 'pedagogy']);

/** Gate findings whose fix is a deterministic move (lib/ai/moves), so no rewrite to approve. */
const MECHANICAL = new Set(['heading.stranded']);

export function disposition(f: Finding): Disposition {
  if (f.severity === 'minor') return 'skip';
  if (MECHANICAL.has(f.rule)) return 'auto';
  if (COSMETIC.has(f.pass)) return 'auto';
  if (EDITORIAL.has(f.pass)) return 'approve';
  return 'skip';
}

const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 } as const;
/** A wrong fact misleads; a badly ordered one merely confuses. Facts go first. */
const PASS_RANK: Record<string, number> = { facts: 0, pedagogy: 1 };

export function triageOrder(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (PASS_RANK[a.pass] ?? 9) - (PASS_RANK[b.pass] ?? 9) ||
    a.page - b.page
  );
}

/** The instruction handed to revisePost. Additive by construction. */
export function requestFor(f: Finding): string {
  return [
    `A review of this handbook found a defect on page ${f.page}.`,
    `Defect: ${f.summary}`,
    f.evidence ? `Evidence: ${f.evidence}` : '',
    `Required change: ${f.fix}`,
    'Make only this change. Do not remove any other block, bullet, table row or code line.',
  ].filter(Boolean).join('\n');
}
