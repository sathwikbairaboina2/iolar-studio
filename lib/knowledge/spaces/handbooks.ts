import type { Post } from '@/lib/schema';
import type { Book } from '@/lib/ai/book';
import type { Subject } from '@/lib/store';
import { getStores } from '../stores';
import { safely } from '../index';
import { topicFromPoint } from '../topics';

/**
 * The handbooks space: Subject, Chapter, and the shared Topic nodes a chapter covers.
 * Same shape the SQLite graph had, on Cypher, plus the `space` every node carries.
 */

const subjectRef = (slug: string) => ({ label: 'Subject', key: { slug } });
const chapterRef = (subject: string, slug: string) => ({ label: 'Chapter', key: { subject, slug } });
const topicRef = (key: string) => ({ label: 'Topic', key: { key } });

export async function syncSubject(subject: Subject): Promise<void> {
  await safely('handbooks.syncSubject', async () => {
    const { graph } = getStores();
    await graph.mergeNode(
      'Subject',
      { slug: subject.slug },
      { space: 'handbooks', name: subject.name, emoji: subject.emoji, label: `${subject.emoji} ${subject.name}`.trim() }
    );
  });
}

async function linkTopic(subject: string, chapter: string, key: string, label: string) {
  const { graph } = getStores();
  await graph.mergeNode('Topic', { key }, { space: 'shared', label: label.slice(0, 60) });
  await graph.mergeEdge(chapterRef(subject, chapter), 'COVERS', topicRef(key));
}

/** Chapters teaching the same topic get a direct edge; rebuilt for this chapter on every write. */
async function rebuildShared(subject: string, chapter: string) {
  const { graph } = getStores();
  await graph.query(
    `MATCH (a:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)<-[:COVERS]-(b:Chapter)
     WHERE a <> b
     WITH a, b, count(t) AS n
     MERGE (a)-[r:SHARES_TOPIC]-(b) SET r.count = n`,
    { subject, chapter }
  );
}

export async function syncChapter(subject: string, chapter: string, post: Post, status: string): Promise<void> {
  await safely('handbooks.syncChapter', async () => {
    const { graph } = getStores();
    await graph.mergeNode(
      'Chapter',
      { subject, slug: chapter },
      { space: 'handbooks', title: post.series, status, parts: 1, weight: post.slides.length }
    );
    await graph.mergeEdge(subjectRef(subject), 'HAS_CHAPTER', chapterRef(subject, chapter));
    for (const slide of post.slides) {
      for (const b of slide.blocks) {
        if (b.type !== 'heading') continue;
        const key = topicFromPoint(b.text);
        if (key.length < 3) continue;
        await linkTopic(subject, chapter, key, b.text.replace(/^\d+\.\s*/, ''));
      }
    }
    await rebuildShared(subject, chapter);
  });
}

export async function syncBook(subject: string, chapter: string, book: Book): Promise<void> {
  await safely('handbooks.syncBook', async () => {
    const { graph } = getStores();
    await graph.mergeNode(
      'Chapter',
      { subject, slug: chapter },
      { space: 'handbooks', title: book.title, summary: book.summary }
    );
    await graph.mergeEdge(subjectRef(subject), 'HAS_CHAPTER', chapterRef(subject, chapter));
    for (const ch of book.chapters) {
      for (const p of ch.points) {
        const key = topicFromPoint(p);
        if (key.length < 3) continue;
        await linkTopic(subject, chapter, key, p.split(/[:—–]/)[0].trim());
      }
    }
    await rebuildShared(subject, chapter);
  });
}

/** Context for the AI and the user: what this chapter covers, and who else covers it. */
export async function chapterContext(subject: string, chapter: string) {
  const { graph } = getStores();
  const topics = await graph.query<{ id: string; label: string; weight: number }>(
    `MATCH (c:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)
     OPTIONAL MATCH (t)<-[cov:COVERS]-()
     RETURN 'topic:' + t.key AS id, t.label AS label, count(cov) AS weight ORDER BY weight DESC`,
    { subject, chapter }
  );
  const related = await graph.query<{ subject: string; chapter: string; title: string; shared: number }>(
    `MATCH (c:Chapter {subject: $subject, slug: $chapter})-[:COVERS]->(t:Topic)<-[:COVERS]-(o:Chapter)
     WHERE o <> c
     RETURN o.subject AS subject, o.slug AS chapter, o.title AS title, count(t) AS shared
     ORDER BY shared DESC LIMIT 10`,
    { subject, chapter }
  );
  return { topics, related };
}

/** Topics covered by other chapters — lets the planner avoid repeating a past chapter. */
export async function coveredElsewhere(subject: string, chapter: string): Promise<string[]> {
  const { graph } = getStores();
  const rows = await graph.query<{ label: string }>(
    `MATCH (o:Chapter)-[:COVERS]->(t:Topic)
     WHERE NOT (o.subject = $subject AND o.slug = $chapter)
     WITH DISTINCT t, size([(t)<-[:COVERS]-() | 1]) AS w
     RETURN t.label AS label ORDER BY w DESC LIMIT 60`,
    { subject, chapter }
  );
  return rows.map((r) => r.label);
}

export async function searchTopics(q: string) {
  const { graph } = getStores();
  return graph.query<{ id: string; label: string; weight: number; chapters: string | null }>(
    `MATCH (t:Topic) WHERE toLower(t.label) CONTAINS toLower($q)
     OPTIONAL MATCH (t)<-[:COVERS]-(c:Chapter)
     WITH t, collect(DISTINCT c.slug) AS chs
     RETURN 'topic:' + t.key AS id, t.label AS label, size(chs) AS weight,
            CASE WHEN size(chs) = 0 THEN null ELSE reduce(s = '', x IN chs | CASE WHEN s = '' THEN x ELSE s + ',' + x END) END AS chapters
     ORDER BY weight DESC LIMIT 50`,
    { q }
  );
}
