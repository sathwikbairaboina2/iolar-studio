import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cat3-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

const concepts = (n: number) => Array.from({ length: n }, (_, i) => ({
  title: `Concept ${i + 1}`, points: [`point ${i + 1}a about this`, `point ${i + 1}b about this`],
  shape: ['what it is', 'why it exists', 'used for', 'how it works', 'benefits', 'things to consider', 'interview takeaway'],
}));

describe('categories, round 3 fixes', () => {
  it('counts item pages only: a cover and a closing cheatsheet are not concepts', async () => {
    const { bookGates } = await import('@/lib/verify/categoryGates');
    const book = { title: '10 Database Concepts', summary: '', chapters: [
      { title: 'Cover', points: ['inside'], shape: ['cover'] }, ...concepts(10), { title: 'Cheatsheet', points: ['recap table'], shape: ['cheatsheet'] },
    ] };
    expect(bookGates(book, 'listicle')).toEqual([]);
  });

  it('forbids page-number references in every category', async () => {
    const { CATEGORIES } = await import('@/lib/handbookCategories');
    for (const c of CATEGORIES) expect(c.content.rules.join(' ')).toMatch(/page number/);
  });

  it('regenerates the book once when it breaks the category rules, telling the model what broke', async () => {
    const book = (n: number) => JSON.stringify({ title: '10 Database Concepts', summary: 's', chapters: concepts(n) });
    const runClaude = vi.fn().mockResolvedValueOnce(book(11)).mockResolvedValueOnce(book(10));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'ten', '10 DB Concepts', 'listicle');
    const { bookFromTopic } = await import('@/lib/ai/book');
    const out = await bookFromTopic('db', 'ten', 'database concepts');
    expect(out.chapters.length).toBe(10);
    expect(runClaude).toHaveBeenCalledTimes(2);
    expect(String(runClaude.mock.calls[1][0])).toContain('The title promises 10 but the book delivers 11');
  });

  it('pulls a thin spill page back into the page it came from, condensed to one page', async () => {
    const { validatePost } = await import('@/lib/schema');
    const post = validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
      slides: [
        { page_title: 'Indexing', blocks: [{ type: 'heading', text: '1. What' }, { type: 'bullets', items: ['B-tree lookups'] }] },
        { page_title: 'Indexing (cont.)', cont: true, blocks: [{ type: 'bullets', items: ['composite index order'] }] },
        { page_title: 'ACID', blocks: [{ type: 'heading', text: '1. A' }] },
      ],
      caption: { text: '', hashtags: [] },
    });
    const condensed = { page_title: 'Indexing', blocks: [{ type: 'heading', text: '1. What' }, { type: 'bullets', items: ['B-tree lookups', 'composite index order'] }] };
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(condensed));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'ten');
    await savePost('db', 'ten', 1, post);
    const { pullBack } = await import('@/lib/ai/plan');
    const out = await pullBack('db', 'ten', 1, 2, 130, async () => [{ slide: 1, neededPct: 96 }]);
    expect(out.slides.map((s) => s.page_title)).toEqual(['Indexing', 'ACID']);
    expect(out.slides[0].blocks[1]).toMatchObject({ items: ['B-tree lookups', 'composite index order'] });
    expect(String(runClaude.mock.calls[0][0])).toContain('130%');
  });

  it('rejects a pull-back that drops material', async () => {
    const { validatePost } = await import('@/lib/schema');
    const post = validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
      slides: [
        { page_title: 'Indexing', blocks: [{ type: 'bullets', items: ['B-tree lookups make reads fast'] }] },
        { page_title: 'Indexing (cont.)', cont: true, blocks: [{ type: 'bullets', items: ['composite index column order matters'] }] },
      ],
      caption: { text: '', hashtags: [] },
    });
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify({ page_title: 'Indexing', blocks: [{ type: 'bullets', items: ['B-tree lookups make reads fast'] }] }));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'ten');
    await savePost('db', 'ten', 1, post);
    const { pullBack } = await import('@/lib/ai/plan');
    await expect(pullBack('db', 'ten', 1, 2, 120, async () => [{ slide: 1, neededPct: 96 }])).rejects.toThrow(/dropped/);
  });
});
