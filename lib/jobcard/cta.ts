import { getSettings } from '@/lib/settings';
import type { JobCardDraft } from './schema';

/**
 * Where "apply" sends a viewer: a page on aiiolar.com. A card made from a pool row names
 * its job by family key, which the jobs page opens directly; every other card gets a search
 * on the jobs page for its role and company, since aiiolar holds no page of its own for it.
 */

type Linkable = {
  role?: { title?: string };
  company?: { name?: string };
  source?: { kind?: string; familyKey?: string };
};

export function applyUrlFor(card: Linkable | JobCardDraft, base: string): string {
  const root = base.replace(/\/+$/, '');
  const c = card as Linkable;
  const key = c.source?.kind === 'pool' ? c.source.familyKey : undefined;
  if (key) return `${root}?job=${encodeURIComponent(key)}`;
  const q = `${c.role?.title ?? ''} ${c.company?.name ?? ''}`.trim();
  return `${root}?q=${encodeURIComponent(q)}`;
}

/** A card on the site channel with no link of its own gets the rule's; every other card is returned as it is. */
export function withApplyUrl<T extends JobCardDraft>(draft: T): T {
  const cta = draft.cta;
  if (!cta || cta.channel !== 'site' || cta.url?.trim()) return draft;
  return { ...draft, cta: { ...cta, url: applyUrlOf(draft) } };
}

/** The link for a card, read from the settings: the base can be moved without touching a card. */
export const applyUrlOf = (card: Linkable | JobCardDraft): string => applyUrlFor(card, getSettings().aiiolarJobsUrl);
