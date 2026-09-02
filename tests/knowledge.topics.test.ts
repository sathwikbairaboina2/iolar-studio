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

  it('has no nodes or edges tables any more', async () => {
    const { getDb } = await import('@/lib/db');
    const names = (getDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    expect(names).not.toContain('nodes');
    expect(names).not.toContain('edges');
    expect(names).toContain('chapters');
  });
});
