import { Family, JobCard } from './schema';

/**
 * Which family a document wants. The score reads the document the way the spec's
 * table does — how many facts it carries, whether it has dates, whether anyone
 * announced a selection process, whether a real logo was found — and the model may
 * override the answer. Nothing here renders; a family that turns out too small for
 * the document is caught by the renderer and swapped for `band-stack`, the family
 * that gives every field its own row and so cannot run out of room.
 */

export type Score = { family: Family; score: number; why: string };

/** The safe default: every mandatory field, one labelled band each. */
export const FALLBACK: Family = 'band-stack';

export function scoreFamilies(card: JobCard): Score[] {
  const facts =
    card.role.skills.length +
    card.eligibility.length +
    card.selectionProcess.length +
    card.dates.length;
  const hasLogo = !!card.company.logo;
  const hasDates = card.dates.length > 0;
  const hasDeadline = card.dates.some((d) => d.kind === 'deadline');
  const isDrive = card.dates.some((d) => d.kind === 'walk-in' || d.kind === 'drive');
  const steps = card.selectionProcess.length;
  // A tile is a small box: one long sentence in the experience line is enough to burst it.
  const shortFacts =
    card.role.skills.every((s) => s.length <= 24) &&
    card.eligibility.every((e) => e.length <= 90) &&
    card.experience.label.length <= 30;

  const scores: Score[] = [
    {
      family: 'split-hero',
      score: (hasLogo ? 3 : -2) + (facts <= 8 ? 2 : -2) + (steps ? -1 : 0),
      why: hasLogo ? 'a company mark to give the top half to, and few enough facts' : 'no mark to fill the hero',
    },
    {
      family: 'infographic',
      // Its rows and bullets are generous, not endless: past a dozen facts they run off the card.
      score: (hasLogo ? -1 : 2) + (card.eligibility.length + card.role.skills.length >= 5 ? 3 : 0) + (steps ? 1 : 0) + (facts > 12 ? -2 : 0),
      why: 'several requirements to list and no image worth showing',
    },
    {
      family: 'campaign',
      score: (isDrive ? 4 : 0) + (hasDates ? 2 : -3) + (steps >= 2 ? 3 : -1),
      why: 'a drive with dates and announced rounds',
    },
    {
      family: 'bento',
      score: (shortFacts ? 3 : -2) + (facts >= 4 && facts <= 12 ? 2 : -1),
      why: 'facts short and of equal weight, one tile each',
    },
    {
      family: 'ticket',
      score: (hasDeadline ? 5 : -2) + (facts <= 10 ? 1 : -2) + (isDrive ? -1 : 0),
      why: hasDeadline ? 'one role with a deadline; the shape is the scroll-stopper' : 'no deadline to print on the stub',
    },
    // The denser the job, the stronger the case for the family that cannot run out of room.
    { family: FALLBACK, score: 1 + (facts >= 13 ? 4 : 0), why: 'nothing may be cut' },
  ];

  return scores.sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
}

export function pickFamily(card: JobCard): Family {
  return scoreFamilies(card)[0].family;
}
