import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, Post } from '@/lib/schema';
import type { Book } from '@/lib/ai/book';

function post(series: string, headings: string[]): Post {
  return validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
    series, date: '29/08/2026',
    slides: [{ page_title: 'P1', blocks: headings.map((h) => ({ type: 'heading', text: h })) }],
    caption: { text: '', hashtags: [] },
  });
}

const book: Book = {
  title: 'Python Data Structures',
  summary: 'Handbook',
  chapters: [
    { title: 'Lists', points: ['Slicing: lst[1:4] returns a copy', 'Append is amortised O(1)'] },
    { title: 'Sets', points: ['Membership testing is O(1) average'] },
  ],
};

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-graph-'));
  const { closeDb } = await import('@/lib/db');
  closeDb();
});

afterEach(async () => {
  const { closeDb } = await import('@/lib/db');
  closeDb();
});

describe('topic extraction', () => {
  it('normalises a syllabus point to a topic key', async () => {
    const { topicFromPoint } = await import('@/lib/graph');
    expect(topicFromPoint('Slicing: lst[1:4] returns a copy')).toBe('slicing');
    expect(topicFromPoint('Append is amortised O(1)')).toContain('append');
  });
});

describe('knowledge graph', () => {
  it('indexes a book into chapters and topics', async () => {
    const { syncBook, graph } = await import('@/lib/graph');
    syncBook('ds', book);
    const g = graph();
    expect(g.nodes.filter((n) => n.type === 'chapter').length).toBe(2);
    expect(g.nodes.some((n) => n.type === 'topic')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'has_chapter')).toBe(true);
  });

  it('links posts that share a topic and reports context', async () => {
    const { syncPost, postContext, coveredElsewhere } = await import('@/lib/graph');
    syncPost('a', post('LISTS DEEP DIVE', ['1. Slicing basics', '2. Sorting lists']), 'draft');
    syncPost('b', post('TUPLES', ['1. Slicing basics', '2. Immutability']), 'draft');

    const ctx = postContext('a');
    expect(ctx.topics.some((t) => t.label.toLowerCase().includes('slicing'))).toBe(true);
    expect(ctx.related.map((r) => r.slug)).toContain('b');

    const elsewhere = coveredElsewhere('a');
    expect(elsewhere.join(' ').toLowerCase()).toContain('immutability');
  });

  it('search finds topics by label', async () => {
    const { syncBook, searchTopics } = await import('@/lib/graph');
    syncBook('ds', book);
    expect(searchTopics('member').length).toBeGreaterThan(0);
  });

  it('savePost writes through to the database', async () => {
    const { createPost } = await import('@/lib/store');
    await createPost('db-demo');
    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT slug, slide_count FROM posts WHERE slug = ?').get('db-demo') as { slug: string; slide_count: number };
    expect(row.slug).toBe('db-demo');
    expect(row.slide_count).toBe(1);
  });
});
