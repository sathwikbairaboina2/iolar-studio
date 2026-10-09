import type { Finding } from '@/lib/verify/gates';
import { loadEdition, saveEdition } from './edition';
import { generateSection } from './generate';
import { reviewEdition, type EditionReview } from './review';

const note = (f: Finding) => `${f.page > 0 ? `page ${f.page}: ` : ''}${f.summary}${f.evidence ? ` (${f.evidence})` : ''}${f.fix ? ` Fix: ${f.fix}` : ''}`;
const isUnavailable = (err: unknown) => (err as { name?: string } | null)?.name === 'ClaudeUnavailableError';
/** Findings worth a regeneration: real defects, not a pass that could not run. */
const actionable = (f: Finding) => f.severity !== 'minor' && !f.rule.endsWith('.unavailable');

/**
 * Reviews the edition and, while it does not pass and rounds remain, regenerates only the sections the
 * findings point at. A section is regenerated at most once, so a stubborn section cannot eat the budget.
 * Findings about the whole chapter (page 0) go to every outline section, in the first round only.
 */
export async function reviewAndFix(
  subject: string,
  chapter: string,
  opts: { rounds?: number; onStep?: (step: string) => void; onReviewStep?: (step: string) => void } = {},
): Promise<EditionReview> {
  const rounds = opts.rounds ?? 2;
  const regenerated = new Set<number>();
  opts.onStep?.('review');
  let review = await reviewEdition(subject, chapter, { onStep: opts.onReviewStep });

  for (let round = 0; round < rounds && review.verdict !== 'pass'; round++) {
    const edition = await loadEdition(subject, chapter);
    if (!edition) break;

    const pageSection: number[] = [];
    edition.sections.forEach((s, si) => s.pages.forEach(() => pageSection.push(si)));
    const notes = new Map<number, string[]>();
    const add = (si: number, f: Finding) => {
      if (!regenerated.has(si)) notes.set(si, [...(notes.get(si) ?? []), note(f)]);
    };
    for (const f of review.findings.filter(actionable)) {
      if (f.page > 0 && pageSection[f.page - 1] !== undefined) add(pageSection[f.page - 1], f);
      else if (round === 0) edition.sections.forEach((s, si) => { if (s.role === 'outline') add(si, f); });
    }
    if (!notes.size) break;

    // A section that cannot be rewritten keeps its text; the others still go in, and the verdict stands for it.
    let rewritten = 0;
    for (const [si, list] of [...notes].sort((a, b) => a[0] - b[0])) {
      const s = edition.sections[si];
      opts.onStep?.(`fix:${s.title}`);
      regenerated.add(si);
      try {
        edition.sections[si] = await generateSection(subject, chapter, { role: s.role, outlineIndex: s.outlineIndex, notes: list });
        rewritten++;
      } catch (err) {
        if (isUnavailable(err)) break;
      }
    }
    if (!rewritten) break;
    edition.generatedAt = new Date().toISOString();
    await saveEdition(edition);

    opts.onStep?.('review');
    review = await reviewEdition(subject, chapter, { onStep: opts.onReviewStep });
  }
  return review;
}
