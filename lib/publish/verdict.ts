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
