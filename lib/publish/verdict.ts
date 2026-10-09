import { listParts } from '@/lib/store';
import { loadReview, reviewIsCurrent } from '@/lib/verify/review';
import type { Finding } from '@/lib/verify/gates';
import type { Verdict } from './state';

/**
 * fail: a blocker anywhere or a major factual error. unsure: another major, or a pass that could
 * not run (it must not pass as clean). pass: only minor findings.
 */
export function chapterVerdict(partFindings: Finding[][], digital: Finding[]): Verdict {
  const all = [...partFindings.flat(), ...digital];
  if (all.some((f) => f.severity === 'blocker' || (f.severity === 'major' && f.pass === 'facts'))) return 'fail';
  if (all.some((f) => f.severity === 'major' || f.rule.endsWith('.unavailable'))) return 'unsure';
  return 'pass';
}

/** Every part's saved findings; `current` is false when any part has no review or one older than its content. */
export async function partReviewsFor(subject: string, chapter: string): Promise<{ current: boolean; findings: Finding[][] }> {
  const parts = await listParts(subject, chapter);
  let current = parts.length > 0;
  const findings: Finding[][] = [];
  for (const n of parts) {
    const review = await loadReview(subject, chapter, n);
    if (!review || !(await reviewIsCurrent(subject, chapter, n))) current = false;
    findings.push(review?.findings ?? []);
  }
  return { current, findings };
}
