import type { ExplainerSummary } from './store';

/**
 * What the list page needs beyond the rows themselves: when something happened, and which rows
 * a search box is asking for.
 *
 * Both are here rather than in the components because both are the kind of thing that is wrong in
 * a way you cannot see — an off by one in a unit boundary, or a filter that matches the title and
 * quietly not the theme.
 */

/** "4m ago", because the clock time of a render is never what anyone wants to know. */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const secs = Math.round((now - new Date(iso).getTime()) / 1000);
  // A machine whose clock has drifted, or a file written a moment ago by a slower call: neither is
  // "in 3 seconds".
  if (!Number.isFinite(secs) || secs < 1) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** Title, theme and slug, because those are the three things anyone knows an explainer by. */
export function search<T extends Pick<ExplainerSummary, 'slug' | 'title' | 'theme'>>(
  rows: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    r.title.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q) || r.slug.includes(q)
  );
}
