import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

const post = (series: string, headings: string[]): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series, date: 'd',
  slides: [{ page_title: 'P', blocks: headings.map((h) => ({ type: 'heading', text: h })) }],
  caption: { text: '', hashtags: [] },
});

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-graph-'));
  (await import('@/lib/db')).closeDb();
});

afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

describe('topic extraction', () => {
  it('normalises a syllabus point to a topic key', async () => {
    const { topicFromPoint } = await import('@/lib/graph');
    expect(topicFromPoint('Slicing: lst[1:4] returns a copy')).toBe('slicing');
    expect(topicFromPoint('Append is amortised O(1)')).toContain('append');
  });
});

describe('graph', () => {
  it('links subject to chapter to topic', async () => {
    const { syncSubject, syncChapter, graph } = await import('@/lib/graph');
    syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    syncChapter('python', 'lists', post('LISTS', ['1. Slicing basics']), 'draft');
    const g = graph();
    expect(g.nodes.some((n) => n.id === 'subject:python')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'chapter:python/lists')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'has_chapter' && e.src === 'subject:python')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'covers')).toBe(true);
  });

  it('reports chapters sharing a topic', async () => {
    const { syncSubject, syncChapter, chapterContext, coveredElsewhere } = await import('@/lib/graph');
    syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    syncChapter('python', 'lists', post('LISTS', ['1. Slicing basics', '2. Sorting']), 'draft');
    syncChapter('python', 'tuples', post('TUPLES', ['1. Slicing basics', '2. Immutability']), 'draft');

    const ctx = chapterContext('python', 'lists');
    expect(ctx.related.map((r) => r.chapter)).toContain('tuples');
    expect(ctx.topics.some((t) => t.label.toLowerCase().includes('slicing'))).toBe(true);
    expect(coveredElsewhere('python', 'lists').join(' ').toLowerCase()).toContain('immutability');

    const { graph } = await import('@/lib/graph');
    expect(graph().edges.some((e) => e.rel === 'shares_topic')).toBe(true);
  });

  it('search finds topics by label', async () => {
    const { syncSubject, syncChapter, searchTopics } = await import('@/lib/graph');
    syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    syncChapter('python', 'sets', post('SETS', ['1. Membership testing']), 'draft');
    expect(searchTopics('member').length).toBeGreaterThan(0);
  });

  it('createChapter writes through to the database', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT subject, slug FROM chapters WHERE subject = ?').get('python') as
      { subject: string; slug: string };
    expect(row).toMatchObject({ subject: 'python', slug: 'lists' });
  });
});

describe('reel indexing', () => {
  it('adds a reel node linked to the topics its beats cover', async () => {
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { graph, reelId } = await import('@/lib/graph');
    await createReel('grok-bot', { title: 'xAI drops Grok Bot' });
    const reel = await loadReel('grok-bot');
    await saveReel('grok-bot', {
      ...reel,
      beats: [
        { id: 'b1', role: 'hook', text: 'Grok Bot ships today', shot: { kind: 'title', brief: '', hero: false } },
        { id: 'b2', role: 'close', text: 'Agent workflows get cheaper', shot: { kind: 'broll', brief: '', hero: false } },
      ],
    });
    const g = graph();
    const node = g.nodes.find((n) => n.id === reelId('grok-bot'));
    expect(node).toMatchObject({ type: 'reel', label: 'xAI drops Grok Bot' });
    expect(g.edges.filter((e) => e.src === reelId('grok-bot') && e.rel === 'covers').length).toBeGreaterThan(0);
  });
});
