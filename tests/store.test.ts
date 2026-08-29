import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-store-'));
});

describe('handbook store', () => {
  it('creates a subject and lists it with counts', async () => {
    const { createSubject, listSubjects } = await import('@/lib/store');
    await createSubject('python', { name: 'Python', emoji: '🐍' });
    const subjects = await listSubjects();
    expect(subjects[0]).toMatchObject({ slug: 'python', name: 'Python', emoji: '🐍', chapters: 0 });
  });

  it('creates a chapter with its first part', async () => {
    const { createSubject, createChapter, listChapters, listParts, loadPost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    expect(await listParts('python', 'lists')).toEqual([1]);
    const chapters = await listChapters('python');
    expect(chapters[0]).toMatchObject({ slug: 'lists', title: 'Python Lists', parts: 1 });
    expect((await loadPost('python', 'lists', 1)).brand).toBe('iolar');
  });

  it('refuses to create a chapter over one that exists', async () => {
    const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    const post = await loadPost('python', 'lists', 1);
    await savePost('python', 'lists', 1, { ...post, series: 'WRITTEN WORK' });

    await expect(createChapter('python', 'lists')).rejects.toThrow(/already exists/);
    // The work that was there is still there.
    expect((await loadPost('python', 'lists', 1)).series).toBe('WRITTEN WORK');
  });

  it('adds parts in order and reports the next number', async () => {
    const { createSubject, createChapter, createPart, loadPost, nextPartNumber, listParts } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    const first = await loadPost('python', 'lists', 1);
    expect(await nextPartNumber('python', 'lists')).toBe(2);
    await createPart('python', 'lists', 2, first);
    expect(await listParts('python', 'lists')).toEqual([1, 2]);
  });

  it('savePost validates', async () => {
    const { createSubject, createChapter, loadPost, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    const p = await loadPost('python', 'lists', 1);
    (p as { ratio: string }).ratio = 'bogus';
    await expect(savePost('python', 'lists', 1, p)).rejects.toThrow();
  });

  it('reports draft status for a fresh part', async () => {
    const { createSubject, createChapter, partStatus } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    expect(await partStatus('python', 'lists', 1)).toBe('draft');
  });
});
