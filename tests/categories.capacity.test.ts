import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CATEGORIES, categoryOf } from '@/lib/handbookCategories';

const rules = (id: string) => categoryOf(id).presentation.pageRules;

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cap-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

describe('capacity per category', () => {
  it('every category carries pointsPerPage and bookPages', () => {
    for (const c of CATEGORIES) {
      expect(c.presentation.pointsPerPage, c.id).toBeGreaterThan(0);
      expect(c.presentation.bookPages, c.id).toBeGreaterThan(0);
    }
  });

  it('the book prompt carries the chapter category\'s numbers, not the global ones', async () => {
    const book = JSON.stringify({ title: 'T', summary: 's', chapters: [{ title: 'c', points: ['p'] }] });
    const runClaude = vi.fn().mockResolvedValue(book);
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'qa', 'API Questions', 'interview-qa');
    const { bookFromTopic } = await import('@/lib/ai/book');
    await bookFromTopic('db', 'qa', 'apis');
    const qa = categoryOf('interview-qa').presentation;
    const prompt = String(runClaude.mock.calls[0][0]);
    expect(prompt).toContain(`at most ${qa.bookPages} chapters`);
    expect(prompt).toContain(`at most ${qa.bookPages * qa.pointsPerPage} points`);
    expect(prompt).toContain(`about ${qa.pointsPerPage} of them`);
  });

  it('the quick-revision handbook plans 6 chapters of 5 points; the other categories keep their numbers', () => {
    expect(categoryOf('handbook').presentation.pointsPerPage).toBe(5);
    expect(categoryOf('handbook').presentation.bookPages).toBe(6);
    expect(CATEGORIES.filter((c) => c.id !== 'handbook').map((c) => c.presentation.bookPages)).toEqual([16, 12, 12, 12]);
    expect(CATEGORIES.filter((c) => c.id !== 'handbook').map((c) => c.presentation.pointsPerPage)).toEqual([4, 7, 5, 6]);
  });

  it('a handbook topic book asks for a quick revision run; the other categories keep the thorough line', async () => {
    const book = JSON.stringify({ title: 'T', summary: 's', chapters: [{ title: 'c', points: ['p'] }] });
    const runClaude = vi.fn().mockResolvedValue(book);
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'hb', 'Git', 'handbook');
    await createChapter('db', 'qa', 'API Questions', 'interview-qa');
    const { bookFromTopic } = await import('@/lib/ai/book');
    await bookFromTopic('db', 'hb', 'git');
    await bookFromTopic('db', 'qa', 'apis');
    const hb = String(runClaude.mock.calls[0][0]);
    const qa = String(runClaude.mock.calls[1][0]);
    expect(hb).toContain('end to end');
    expect(hb).toContain('cheat sheet last');
    expect(hb).not.toContain('Cover the topic thoroughly');
    expect(qa).toContain('Cover the topic thoroughly');
    for (const p of [hb, qa]) {
      expect(p).not.toContain('6-12 points per chapter');
      expect(p).toContain('must-remember fact');
    }
  });

  it('without a category (references mode) the budget keeps the global constants', async () => {
    const { partBudget } = await import('@/lib/ai/book');
    const { BOOK_PAGES } = await import('@/lib/schema');
    const text = partBudget();
    expect(text).toContain(`at most ${BOOK_PAGES} chapters`);
    expect(text).toContain(`at most ${BOOK_PAGES * 12} points`);
  });

  it('drills plan 5-6 tasks a page: that is what a full page holds', () => {
    const d = categoryOf('drills');
    expect(d.presentation.itemsPerPage).toBe('5-6 tasks');
    expect(d.presentation.pageRules).toContain('5-6 tasks per page');
    expect(d.presentation.pageRules).not.toContain('8-12 tasks');
    expect(d.content.unit).not.toMatch(/per page/);
  });

  it('every category allows at most one intro page and one closing page', () => {
    for (const c of CATEGORIES) {
      expect(c.content.bookGuidance, c.id).toMatch(/at most ONE intro page/i);
      expect(c.content.bookGuidance, c.id).toMatch(/at most ONE closing page/i);
    }
    expect(categoryOf('drills').content.bookGuidance).toMatch(/whole schema[^.]*one page/i);
    expect(categoryOf('drills').content.bookGuidance).toMatch(/never separate data-loading pages/i);
  });
});

describe('item brevity rules', () => {
  it('interview-qa: one-sentence answers, three short key points, one small visual, 4 per page', () => {
    const r = rules('interview-qa');
    expect(r).toMatch(/ONE sentence/);
    expect(r).toMatch(/at most 3 key points of at most 10 words/i);
    expect(r).toMatch(/at most one small table, diagram or 4-line code block/i);
    expect(r).toMatch(/4 questions per page/i);
  });

  it('drills: code, result and title ceilings', () => {
    const r = rules('drills');
    expect(r).toMatch(/code at most 6 lines/i);
    expect(r).toMatch(/at most 3 rows and 3 columns/i);
    expect(r).toMatch(/at most 6 words/i);
  });

  it('listicle: label rows at most 12 words, one worked example', () => {
    const r = rules('listicle');
    expect(r).toMatch(/at most 12 words/i);
    expect(r).toMatch(/ONE (diagram or table )?worked example/);
  });

  it('handbook and system-design: at most 8 numbered sections per page, bullets at most 12 words', () => {
    for (const id of ['handbook', 'system-design']) {
      expect(rules(id), id).toMatch(/at most 8 numbered sections/i);
      expect(rules(id), id).toMatch(/bullets at most 12 words/i);
    }
  });
});
