import { getDb } from './db';

/**
 * What the box in the top bar looks through.
 *
 * The studio already knows everything worth finding — it is just spread over three shelves and a
 * SQLite index. This gathers them into one flat list of places you can land on, so a chapter, an
 * explainer and a reel that all mention "cdn" come back together and each one is a link.
 *
 * The ranking is deliberately dumb and explainable: a title that starts with what you typed beats
 * one that merely contains it, and a subject beats the chapters underneath it. Nobody should have
 * to wonder why a hit is where it is.
 */

export type SearchHit = {
  kind: 'subject' | 'chapter' | 'topic' | 'explainer' | 'reel';
  label: string;
  /** The line under the label: where the hit lives, or what state it is in. */
  sub: string;
  href: string;
};

/** Per-kind cap, so one crowded shelf cannot push the other three off the list. */
export const PER_KIND = 5;

const norm = (s: string) => s.trim().toLowerCase();

/** 0 = no match, 1 = contains, 2 = starts with, 3 = exact. Higher sorts first. */
export function score(haystack: string, query: string): number {
  const h = norm(haystack);
  const q = norm(query);
  if (!q || !h.includes(q)) return 0;
  if (h === q) return 3;
  return h.startsWith(q) ? 2 : 1;
}

/** Best score across the fields a row can be known by (title, slug, whatever else it carries). */
const best = (query: string, ...fields: (string | null | undefined)[]) =>
  Math.max(0, ...fields.map((f) => (f ? score(f, query) : 0)));

type Scored = SearchHit & { rank: number };

/** Highest rank first, then alphabetical, then capped — so the order never depends on disk order. */
function take(rows: Scored[]): SearchHit[] {
  return rows
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label))
    .slice(0, PER_KIND)
    .map((r): SearchHit => ({ kind: r.kind, label: r.label, sub: r.sub, href: r.href }));
}

/** Handbook subjects and chapters, straight out of the index the renders keep up to date. */
export function searchHandbooks(query: string): SearchHit[] {
  const db = getDb();

  const subjects = db
    .prepare('SELECT slug, name, emoji, description FROM subjects')
    .all() as { slug: string; name: string | null; emoji: string | null; description: string | null }[];

  const chapters = db
    .prepare('SELECT subject, slug, title, pages, status FROM chapters')
    .all() as { subject: string; slug: string; title: string | null; pages: number | null; status: string | null }[];

  const subjectHits: Scored[] = subjects.map((s) => ({
    kind: 'subject',
    label: `${s.emoji ? `${s.emoji} ` : ''}${s.name ?? s.slug}`,
    sub: s.description || 'subject',
    href: `/handbooks/${s.slug}`,
    rank: best(query, s.name, s.slug, s.description),
  }));

  const chapterHits: Scored[] = chapters.map((c) => ({
    kind: 'chapter',
    label: c.title ?? c.slug,
    sub: `${c.subject}${c.pages ? ` · ${c.pages} pages` : ''}${c.status ? ` · ${c.status}` : ''}`,
    href: `/handbooks/${c.subject}/${c.slug}`,
    rank: best(query, c.title, c.slug),
  }));

  // A topic is one section of a chapter's book, found by its title or any point it teaches,
  // so "TaskGroup" lands on the chapter that covers it even when no title says so.
  const titleOf = new Map(chapters.map((c) => [`${c.subject}/${c.slug}`, c.title ?? c.slug]));
  const books = db
    .prepare('SELECT subject, chapter, book_json FROM books')
    .all() as { subject: string; chapter: string; book_json: string }[];
  const topicHits: Scored[] = books.flatMap((b) => {
    let sections: { title: string; points?: string[] }[] = [];
    try { sections = JSON.parse(b.book_json).chapters ?? []; } catch { /* unreadable row: no topics */ }
    return sections.map((sec, i) => ({
      kind: 'topic' as const,
      label: sec.title,
      sub: titleOf.get(`${b.subject}/${b.chapter}`) ?? b.chapter,
      // The chapter page turns the section into the part and page that teach it; it also keeps
      // two topics of one chapter from sharing a link (the box keys its options by href).
      href: `/handbooks/${b.subject}/${b.chapter}?topic=${i}`,
      // A point that mentions it counts for less than the section being named after it.
      rank: Math.max(best(query, sec.title), Math.min(1, best(query, ...(sec.points ?? [])))),
    }));
  });

  return [...take(subjectHits), ...take(chapterHits), ...take(topicHits)];
}

export function searchExplainers(
  rows: { slug: string; title: string; theme: string }[],
  query: string
): SearchHit[] {
  return take(
    rows.map((r) => ({
      kind: 'explainer' as const,
      label: r.title,
      sub: r.theme,
      href: `/explainers/${r.slug}`,
      rank: best(query, r.title, r.slug, r.theme),
    }))
  );
}

export function searchReels(
  rows: { slug: string; title: string; style: string; status: string }[],
  query: string
): SearchHit[] {
  return take(
    rows.map((r) => ({
      kind: 'reel' as const,
      label: r.title,
      sub: `${r.style} · ${r.status}`,
      href: `/reel/${r.slug}`,
      rank: best(query, r.title, r.slug, r.style),
    }))
  );
}
