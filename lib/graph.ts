import { getDb } from './db';
import type { Post } from './schema';
import type { Book } from './ai/book';
import type { Subject } from './store';
import type { Reel } from './reel/schema';

/** Normalises a phrase to a topic key so the same concept from different chapters collides. */
export function topicKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|to|in|for|with|is|are|its|it|you|your|how|what|why|when|use|using|python|vs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the salient topic phrase out of a syllabus point ("Slicing: lst[1:4] ..." -> "slicing"). */
export function topicFromPoint(point: string): string {
  const head = point.split(/[:—–\-(]/)[0];
  return topicKey(head).split(' ').filter(Boolean).slice(0, 4).join(' ');
}

export type GraphNode = {
  id: string;
  type: 'subject' | 'chapter' | 'topic' | 'reel';
  label: string;
  subject: string | null;
  chapter: string | null;
  weight: number;
};
export type GraphEdge = { src: string; dst: string; rel: string };

export const subjectId = (s: string) => `subject:${s}`;
export const chapterId = (s: string, c: string) => `chapter:${s}/${c}`;
export const reelId = (slug: string) => `reel:${slug}`;

/** Mirrors a reel into SQLite and links it to the topics its script covers. */
export function syncReel(slug: string, reel: Reel, status: string) {
  const db = getDb();
  const duration = reel.timeline.clips.reduce((m, c) => Math.max(m, c.end), 0) || reel.vo.durationSec;
  db.prepare(
    `INSERT INTO reels (slug, title, pattern, beats, duration_ms, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, pattern=excluded.pattern, beats=excluded.beats,
       duration_ms=excluded.duration_ms, status=excluded.status, updated_at=excluded.updated_at`
  ).run(slug, reel.title, reel.pattern, reel.beats.length, Math.round(duration * 1000), status);

  db.prepare(
    `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'reel', ?, NULL, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label`
  ).run(reelId(slug), reel.title);

  db.prepare('DELETE FROM edges WHERE src = ? AND rel = ?').run(reelId(slug), 'covers');
  const seen = new Set<string>();
  for (const beat of reel.beats) {
    const key = topicFromPoint(beat.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = `topic:${key}`;
    db.prepare(
      `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'topic', ?, NULL, NULL, 1)
       ON CONFLICT(id) DO UPDATE SET weight = nodes.weight + 1`
    ).run(id, key);
    db.prepare(
      `INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'covers') ON CONFLICT DO NOTHING`
    ).run(reelId(slug), id);
  }
}

export function syncSubject(subject: Subject) {
  const db = getDb();
  db.prepare(
    `INSERT INTO subjects (slug, name, emoji, description, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       name=excluded.name, emoji=excluded.emoji,
       description=excluded.description, updated_at=excluded.updated_at`
  ).run(subject.slug, subject.name, subject.emoji, subject.description);

  db.prepare(
    `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'subject', ?, ?, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label`
  ).run(subjectId(subject.slug), `${subject.emoji} ${subject.name}`.trim(), subject.slug);
}

export function syncChapter(subject: string, chapter: string, post: Post, status: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO chapters (subject, slug, title, parts, points, pages, avg_fill, status, updated_at)
     VALUES (?, ?, ?, 1, 0, 0, 0, ?, datetime('now'))
     ON CONFLICT(subject, slug) DO UPDATE SET
       title=excluded.title, status=excluded.status, updated_at=excluded.updated_at`
  ).run(subject, chapter, post.series, status);

  const id = chapterId(subject, chapter);
  db.prepare(
    `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'chapter', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, weight=excluded.weight`
  ).run(id, post.series, subject, chapter, post.slides.length);

  db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'has_chapter') ON CONFLICT DO NOTHING`)
    .run(subjectId(subject), id);

  // Slide headings are the chapter's own claim of what it teaches.
  for (const slide of post.slides) {
    for (const b of slide.blocks) {
      if (b.type !== 'heading') continue;
      const key = topicFromPoint(b.text);
      if (key.length < 3) continue;
      linkTopic(id, key, b.text.replace(/^\d+\.\s*/, ''));
    }
  }
  rebuildSharedTopicEdges();
}

export function syncBook(subject: string, chapter: string, book: Book) {
  const db = getDb();
  db.prepare(
    `INSERT INTO books (subject, chapter, title, summary, book_json, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(subject, chapter) DO UPDATE SET
       title=excluded.title, summary=excluded.summary,
       book_json=excluded.book_json, updated_at=excluded.updated_at`
  ).run(subject, chapter, book.title, book.summary, JSON.stringify(book));

  const id = chapterId(subject, chapter);
  db.prepare(
    `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'chapter', ?, ?, ?, 1)
     ON CONFLICT(id) DO NOTHING`
  ).run(id, book.title, subject, chapter);
  db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'has_chapter') ON CONFLICT DO NOTHING`)
    .run(subjectId(subject), id);

  for (const ch of book.chapters) {
    for (const p of ch.points) {
      const key = topicFromPoint(p);
      if (key.length < 3) continue;
      linkTopic(id, key, p.split(/[:—–]/)[0].trim());
    }
  }
  rebuildSharedTopicEdges();
}

function linkTopic(srcId: string, key: string, label: string) {
  const db = getDb();
  const id = `topic:${key}`;
  db.prepare(
    `INSERT INTO nodes (id, type, label, subject, chapter, weight) VALUES (?, 'topic', ?, NULL, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET weight = nodes.weight + 1`
  ).run(id, label.slice(0, 60));
  db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'covers') ON CONFLICT DO NOTHING`).run(srcId, id);
}

/** Chapters teaching the same topic get a direct edge — this is what makes the graph useful. */
function rebuildSharedTopicEdges() {
  const db = getDb();
  db.prepare(`DELETE FROM edges WHERE rel = 'shares_topic'`).run();
  const rows = db.prepare(
    `SELECT DISTINCT a.id AS a_id, b.id AS b_id
       FROM edges ea JOIN nodes a ON a.id = ea.src
       JOIN edges eb ON eb.dst = ea.dst
       JOIN nodes b ON b.id = eb.src
      WHERE ea.rel = 'covers' AND eb.rel = 'covers'
        AND a.type = 'chapter' AND b.type = 'chapter' AND a.id < b.id`
  ).all() as { a_id: string; b_id: string }[];
  for (const r of rows) {
    db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'shares_topic') ON CONFLICT DO NOTHING`)
      .run(r.a_id, r.b_id);
  }
}

export function syncRenders(
  subject: string, chapter: string, part: number,
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

export function graph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const db = getDb();
  return {
    nodes: db.prepare(`SELECT id, type, label, subject, chapter, weight FROM nodes ORDER BY weight DESC`).all() as GraphNode[],
    edges: db.prepare(`SELECT src, dst, rel FROM edges`).all() as GraphEdge[],
  };
}

/** Context for the AI and the user: what this chapter covers, and who else covers it. */
export function chapterContext(subject: string, chapter: string) {
  const db = getDb();
  const topics = db.prepare(
    `SELECT DISTINCT n.id, n.label, n.weight FROM edges e
       JOIN nodes n ON n.id = e.dst
      WHERE e.rel = 'covers' AND e.src = ?
      ORDER BY n.weight DESC`
  ).all(chapterId(subject, chapter)) as { id: string; label: string; weight: number }[];

  const related = db.prepare(
    `SELECT n2.subject AS subject, n2.chapter AS chapter, n2.label AS title, COUNT(*) AS shared
       FROM edges e1
       JOIN edges e2 ON e1.dst = e2.dst AND e1.rel = 'covers' AND e2.rel = 'covers'
       JOIN nodes n2 ON n2.id = e2.src
      WHERE e1.src = ? AND e2.src != ? AND n2.type = 'chapter'
      GROUP BY n2.id ORDER BY shared DESC LIMIT 10`
  ).all(chapterId(subject, chapter), chapterId(subject, chapter)) as
    { subject: string; chapter: string; title: string; shared: number }[];

  return { topics, related };
}

/** Topics covered by other chapters — lets the planner avoid repeating a past chapter. */
export function coveredElsewhere(subject: string, chapter: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT n.label FROM edges e
       JOIN nodes n ON n.id = e.dst
       JOIN nodes s ON s.id = e.src
      WHERE e.rel = 'covers' AND s.type = 'chapter' AND s.id != ?
      ORDER BY n.weight DESC LIMIT 60`
  ).all(chapterId(subject, chapter)) as { label: string }[];
  return rows.map((r) => r.label);
}

export function searchTopics(q: string) {
  const db = getDb();
  return db.prepare(
    `SELECT n.id, n.label, n.weight,
            (SELECT GROUP_CONCAT(DISTINCT s.chapter) FROM edges e JOIN nodes s ON s.id = e.src
              WHERE e.dst = n.id AND e.rel = 'covers' AND s.type = 'chapter') AS chapters
       FROM nodes n
      WHERE n.type = 'topic' AND n.label LIKE ?
      ORDER BY n.weight DESC LIMIT 50`
  ).all(`%${q}%`) as { id: string; label: string; weight: number; chapters: string | null }[];
}
