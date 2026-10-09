import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-graph-'));
  (await import('@/lib/db')).closeDb();
});

afterEach(async () => {
  (await import('@/lib/db')).closeDb();
});

describe('topic extraction', () => {
  it('normalises a syllabus point to a topic key', async () => {
    const { topicFromPoint } = await import('@/lib/knowledge/topics');
    expect(topicFromPoint('Slicing: lst[1:4] returns a copy')).toBe('slicing');
    expect(topicFromPoint('Append is amortised O(1)')).toContain('append');
    // A numbered heading is the same topic as the unnumbered one.
    expect(topicFromPoint('1. Slicing basics')).toBe('slicing basics');
  });
});

describe('the sqlite index without its graph', () => {
  it('createChapter still writes through to the chapters table', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT subject, slug FROM chapters WHERE subject = ?').get('python') as {
      subject: string;
      slug: string;
    };
    expect(row).toMatchObject({ subject: 'python', slug: 'lists' });
  });

  it('keeps the chapter title when a part is saved, not the carousel header', async () => {
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    const { validatePost } = await import('@/lib/schema');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    await savePost('python', 'lists', 2, validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'PYTHON LISTS — PART 2', date: 'd',
      caption: { text: '', hashtags: [] }, slides: [{ page_title: 'Slicing', blocks: [{ type: 'paragraph', text: 'body' }] }],
    }));
    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT title FROM chapters WHERE subject = ? AND slug = ?').get('python', 'lists') as { title: string };
    expect(row.title).toBe('Python Lists');
  });

  it('finds a topic taught in a chapter book, under the chapter it lives in', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    const { indexBook } = await import('@/lib/handbookIndex');
    const { searchHandbooks } = await import('@/lib/search');
    await createSubject('python');
    await createChapter('python', 'tasks', 'Tasks & Cancellation');
    indexBook('python', 'tasks', {
      title: 'Tasks', summary: 's',
      chapters: [
        { title: 'Structured Concurrency', points: ['TaskGroup cancels siblings on the first error'] },
        { title: 'Timeouts', points: ['asyncio.timeout wraps a block'] },
      ],
    });
    const hits = searchHandbooks('taskgroup').filter((h) => h.kind === 'topic');
    expect(hits).toEqual([{ kind: 'topic', label: 'Structured Concurrency', sub: 'Tasks & Cancellation', href: '/handbooks/python/tasks?topic=0' }]);
    // Two topics of one chapter must not share a link: the search box keys its options by href.
    const both = searchHandbooks('asyncio').concat(searchHandbooks('taskgroup')).filter((h) => h.kind === 'topic');
    expect(new Set(both.map((h) => h.href))).toEqual(new Set(['/handbooks/python/tasks?topic=0', '/handbooks/python/tasks?topic=1']));
  });

  it('has no nodes or edges tables any more', async () => {
    const { getDb } = await import('@/lib/db');
    const names = (getDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(names).not.toContain('nodes');
    expect(names).not.toContain('edges');
    expect(names).toContain('chapters');
  });
});
