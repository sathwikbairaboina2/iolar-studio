import { Family, JobCard } from './schema';

/**
 * Which family a document wants. The score reads the document the way the spec's
 * table does — how many facts it carries, whether it has dates, whether anyone
 * announced a selection process, whether a real logo was found — and the model may
 * override the answer. Nothing here renders; a family that turns out too small for
 * the document is caught by the renderer and swapped for `campaign`, the family
 * that holds a full job.
 */

export type Score = { family: Family; score: number; why: string };

/** The safe default: the family that holds every mandatory field and a full set of rounds. */
export const FALLBACK: Family = 'campaign';

export function scoreFamilies(card: JobCard): Score[] {
  const facts =
    card.role.skills.length +
    card.eligibility.length +
    card.selectionProcess.length +
    card.dates.length;
  const hasLogo = !!card.company.logo;
  const hasDates = card.dates.length > 0;
  const isDrive = card.dates.some((d) => d.kind === 'walk-in' || d.kind === 'drive');
  const steps = card.selectionProcess.length;

  const scores: Score[] = [
    {
      family: 'infographic',
      // Its rows and bullets are generous, not endless: past a dozen facts they run off the card.
      score: (hasLogo ? -1 : 2) + (card.eligibility.length + card.role.skills.length >= 5 ? 3 : 0) + (steps ? 1 : 0) + (facts > 12 ? -2 : 0),
      why: 'several requirements to list and no image worth showing',
    },
    {
      family: 'campaign',
      // The denser the job, the stronger the case for the family that cannot run out of room.
      score: (isDrive ? 4 : 0) + (hasDates ? 2 : -3) + (steps >= 2 ? 3 : -1) + (facts >= 13 ? 4 : 0),
      why: 'a drive with dates and announced rounds, or a job too full for anything smaller',
    },
  ];

  return scores.sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
}

export function pickFamily(card: JobCard): Family {
  return scoreFamilies(card)[0].family;
}
