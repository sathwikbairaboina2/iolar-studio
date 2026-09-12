import type { Brief } from './schema';

/**
 * What the writing stage is still waiting for before it can ask the model.
 *
 * A greyed out button is the worst answer a form can give: it says no and refuses to say why. The
 * card shows this sentence instead, under the button that is off because of it.
 *
 * Audience is not on the list on purpose. The create form already defaults it to "engineers", and
 * a draft written for a reasonable default beats a draft you could not start.
 */
export function missingForDraft(brief: Pick<Brief, 'topic' | 'claim'>): string | null {
  const wants: string[] = [];
  if (!brief.topic.trim()) wants.push('a topic');
  if (!brief.claim.trim()) wants.push('the one thing that must land');
  if (wants.length === 0) return null;
  return `Needs ${wants.join(' and ')}.`;
}
