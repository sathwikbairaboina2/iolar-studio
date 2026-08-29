import { getDb } from './db';
import type { Post } from './schema';
import type { Book } from './ai/book';

/** Normalises a phrase to a topic key so the same concept from different posts collides. */
export function topicKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|to|in|for|with|is|are|its|it|you|your|how|what|why|when|use|using|python|vs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the salient topic phrase out of a syllabus point ("Slicing: lst[1:4] returns ..." -> "slicing"). */
export function topicFromPoint(point: string): string {
  const head = point.split(/[:—–\-(]/)[0];
  const key = topicKey(head);
  const words = key.split(' ').filter(Boolean).slice(0, 4);
  return words.join(' ');
}

export type GraphNode = { id: string; type: 'post' | 'chapter' | 'topic'; label: string; slug: string | null; weight: number };
export type GraphEdge = { src: string; dst: string; rel: string };

export function syncPost(slug: string, post: Post, status: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO posts (slug, category, series, template, ratio, slide_count, status, post_json, updated_at)
     VALUES (?, 'paperbook', ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       series=excluded.series, template=excluded.template, ratio=excluded.ratio,
       slide_count=excluded.slide_count, status=excluded.status,
       post_json=excluded.post_json, updated_at=excluded.updated_at`
  ).run(slug, post.series, post.template, post.ratio, post.slides.length, status, JSON.stringify(post));

  const postId = `post:${slug}`;
  db.prepare(
    `INSERT INTO nodes (id, type, label, slug, weight) VALUES (?, 'post', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, weight=excluded.weight`
  ).run(postId, post.series, slug, post.slides.length);

  // Slide headings are the post's own claim of what it teaches.
  for (const slide of post.slides) {
    for (const b of slide.blocks) {
      if (b.type !== 'heading') continue;
      const key = topicFromPoint(b.text);
      if (key.length < 3) continue;
      linkTopic(postId, key, b.text.replace(/^\d+\.\s*/, ''));
    }
  }
  rebuildSharedTopicEdges();
}

export function syncBook(slug: string, book: Book) {
  const db = getDb();
  db.prepare(
    `INSERT INTO books (slug, title, summary, book_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, summary=excluded.summary, book_json=excluded.book_json, updated_at=excluded.updated_at`
  ).run(slug, book.title, book.summary, JSON.stringify(book));

  const postId = `post:${slug}`;
  db.prepare(
    `INSERT INTO nodes (id, type, label, slug, weight) VALUES (?, 'post', ?, ?, 1)
     ON CONFLICT(id) DO NOTHING`
  ).run(postId, book.title, slug);

  book.chapters.forEach((ch, i) => {
    const chId = `chapter:${slug}:${i}`;
    db.prepare(
      `INSERT INTO nodes (id, type, label, slug, weight) VALUES (?, 'chapter', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, weight=excluded.weight`
    ).run(chId, ch.title, slug, ch.points.length);
    db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'has_chapter') ON CONFLICT DO NOTHING`).run(postId, chId);

    for (const p of ch.points) {
      const key = topicFromPoint(p);
      if (key.length < 3) continue;
      linkTopic(chId, key, p.split(/[:—–]/)[0].trim());
    }
  });
  rebuildSharedTopicEdges();
}

function linkTopic(srcId: string, key: string, label: string) {
  const db = getDb();
  const topicId = `topic:${key}`;
  db.prepare(
    `INSERT INTO nodes (id, type, label, slug, weight) VALUES (?, 'topic', ?, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET weight = nodes.weight + 1`
  ).run(topicId, label.slice(0, 60));
  db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'covers') ON CONFLICT DO NOTHING`).run(srcId, topicId);
}

/** Posts that teach the same topic get a direct edge — this is what makes the graph useful for context. */
function rebuildSharedTopicEdges() {
  const db = getDb();
  db.prepare(`DELETE FROM edges WHERE rel = 'shares_topic'`).run();
  const rows = db.prepare(
    `SELECT DISTINCT a.slug AS a_slug, b.slug AS b_slug
       FROM edges ea JOIN nodes a ON a.id = ea.src
       JOIN edges eb ON eb.dst = ea.dst
       JOIN nodes b ON b.id = eb.src
      WHERE ea.rel = 'covers' AND eb.rel = 'covers'
        AND a.slug IS NOT NULL AND b.slug IS NOT NULL AND a.slug < b.slug`
  ).all() as { a_slug: string; b_slug: string }[];
  for (const r of rows) {
    db.prepare(`INSERT INTO edges (src, dst, rel) VALUES (?, ?, 'shares_topic') ON CONFLICT DO NOTHING`)
      .run(`post:${r.a_slug}`, `post:${r.b_slug}`);
  }
}

export function syncRenders(slug: string, results: { slide: number; overflowPx: number; fillPct: number }[]) {
  const db = getDb();
  for (const r of results) {
    db.prepare(
      `INSERT INTO renders (slug, slide, overflow_px, fill_pct, rendered_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug, slide) DO UPDATE SET
         overflow_px=excluded.overflow_px, fill_pct=excluded.fill_pct, rendered_at=excluded.rendered_at`
    ).run(slug, r.slide, r.overflowPx, r.fillPct);
  }
}

export function syncReferences(slug: string, urls: string[]) {
  const db = getDb();
  db.prepare(`DELETE FROM refs WHERE slug = ?`).run(slug);
  urls.forEach((u, i) => db.prepare(`INSERT INTO refs (slug, idx, url) VALUES (?, ?, ?)`).run(slug, i, u));
}

export function graph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const db = getDb();
  return {
    nodes: db.prepare(`SELECT id, type, label, slug, weight FROM nodes ORDER BY weight DESC`).all() as GraphNode[],
    edges: db.prepare(`SELECT src, dst, rel FROM edges`).all() as GraphEdge[],
  };
}

/** Context for the AI and the user: what this post covers, and who else covers it. */
export function postContext(slug: string) {
  const db = getDb();
  const topics = db.prepare(
    `SELECT DISTINCT n.id, n.label, n.weight FROM edges e
       JOIN nodes n ON n.id = e.dst
       JOIN nodes s ON s.id = e.src
      WHERE e.rel = 'covers' AND s.slug = ?
      ORDER BY n.weight DESC`
  ).all(slug) as { id: string; label: string; weight: number }[];

  const related = db.prepare(
    `SELECT p.slug, p.series, COUNT(*) AS shared FROM edges e1
       JOIN edges e2 ON e1.dst = e2.dst AND e1.rel = 'covers' AND e2.rel = 'covers'
       JOIN nodes n1 ON n1.id = e1.src
       JOIN nodes n2 ON n2.id = e2.src
       JOIN posts p ON p.slug = n2.slug
      WHERE n1.slug = ? AND n2.slug != ?
      GROUP BY p.slug ORDER BY shared DESC LIMIT 10`
  ).all(slug, slug) as { slug: string; series: string; shared: number }[];

  return { topics, related };
}

/** Topics already covered elsewhere — lets the planner avoid repeating a past post. */
export function coveredElsewhere(slug: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT n.label FROM edges e
       JOIN nodes n ON n.id = e.dst
       JOIN nodes s ON s.id = e.src
      WHERE e.rel = 'covers' AND s.slug IS NOT NULL AND s.slug != ?
      ORDER BY n.weight DESC LIMIT 60`
  ).all(slug) as { label: string }[];
  return rows.map((r) => r.label);
}

export function searchTopics(q: string) {
  const db = getDb();
  return db.prepare(
    `SELECT n.id, n.label, n.weight,
            (SELECT GROUP_CONCAT(DISTINCT s.slug) FROM edges e JOIN nodes s ON s.id = e.src
              WHERE e.dst = n.id AND e.rel = 'covers' AND s.slug IS NOT NULL) AS slugs
       FROM nodes n
      WHERE n.type = 'topic' AND n.label LIKE ?
      ORDER BY n.weight DESC LIMIT 50`
  ).all(`%${q}%`) as { id: string; label: string; weight: number; slugs: string | null }[];
}
