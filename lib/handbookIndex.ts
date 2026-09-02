import { getDb } from './db';
import type { Post } from './schema';
import type { Book } from './ai/book';
import type { Subject } from './store';

/**
 * The SQLite bookkeeping that stayed behind when the graph moved to Neo4j: the subject,
 * chapter and book rows the handbook pages list from, per-slide render measurements for
 * the fit loop, and a chapter's reference list. None of it is knowledge; all of it is
 * what the handbook renderer needs next to the files.
 */

export function indexSubject(subject: Subject) {
  getDb()
    .prepare(
      `INSERT INTO subjects (slug, name, emoji, description, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET
         name=excluded.name, emoji=excluded.emoji,
         description=excluded.description, updated_at=excluded.updated_at`
    )
    .run(subject.slug, subject.name, subject.emoji, subject.description);
}

export function indexChapter(subject: string, chapter: string, post: Post, status: string) {
  getDb()
    .prepare(
      `INSERT INTO chapters (subject, slug, title, parts, points, pages, avg_fill, status, updated_at)
       VALUES (?, ?, ?, 1, 0, 0, 0, ?, datetime('now'))
       ON CONFLICT(subject, slug) DO UPDATE SET
         title=excluded.title, status=excluded.status, updated_at=excluded.updated_at`
    )
    .run(subject, chapter, post.series, status);
}

export function indexBook(subject: string, chapter: string, book: Book) {
  getDb()
    .prepare(
      `INSERT INTO books (subject, chapter, title, summary, book_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(subject, chapter) DO UPDATE SET
         title=excluded.title, summary=excluded.summary,
         book_json=excluded.book_json, updated_at=excluded.updated_at`
    )
    .run(subject, chapter, book.title, book.summary, JSON.stringify(book));
}

export function syncRenders(
  subject: string,
  chapter: string,
  part: number,
  results: { slide: number; overflowPx: number; fillPct: number }[]
) {
  const db = getDb();
  for (const r of results) {
    db.prepare(
      `INSERT INTO renders (subject, chapter, part, slide, overflow_px, fill_pct, rendered_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(subject, chapter, part, slide) DO UPDATE SET
         overflow_px=excluded.overflow_px, fill_pct=excluded.fill_pct, rendered_at=excluded.rendered_at`
    ).run(subject, chapter, part, r.slide, r.overflowPx, r.fillPct);
  }
}

export function syncReferences(subject: string, chapter: string, urls: string[]) {
  const db = getDb();
  db.prepare(`DELETE FROM refs WHERE subject = ? AND chapter = ?`).run(subject, chapter);
  urls.forEach((u, i) =>
    db.prepare(`INSERT INTO refs (subject, chapter, idx, url) VALUES (?, ?, ?, ?)`).run(subject, chapter, i, u)
  );
}
