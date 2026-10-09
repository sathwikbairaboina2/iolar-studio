import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cat2-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

describe('categories, round 2 fixes', () => {
  it("uses Instagram's 20-image carousel, while a book still aims under it so spills have room", async () => {
    const { MAX_SLIDES, BOOK_PAGES } = await import('@/lib/schema');
    expect(MAX_SLIDES).toBe(20);
    expect(BOOK_PAGES).toBeLessThan(MAX_SLIDES);
  });

  it('gives each category its own fill target; a listicle page is meant to breathe', async () => {
    const { categoryOf } = await import('@/lib/handbookCategories');
    expect(categoryOf('handbook').presentation.minFill).toBe(85);
    expect(categoryOf('listicle').presentation.minFill).toBeLessThanOrEqual(65);
  });

  it('reads thin pages against the category target and gives a spill-born page one gentle try at most', async () => {
    const { thinPages } = await import('@/lib/ai/fill');
    const rs = [{ slide: 1, fillPct: 70 }, { slide: 2, fillPct: 50 }, { slide: 3, fillPct: 40 }];
    expect(thinPages(rs, 60).map((r) => r.slide)).toEqual([2, 3]);
    expect(thinPages(rs, 85).map((r) => r.slide)).toEqual([1, 2, 3]);
  });

  it('flags a page title repeated across the parts of a chapter', async () => {
    const { pageTitleGates } = await import('@/lib/verify/categoryGates');
    const f = pageTitleGates([['Intro', 'Cart and Checkout'], ['Cart and Checkout', 'Payments']]);
    expect(f.map((x) => x.rule)).toEqual(['category.duplicate-page']);
    expect(f[0].summary).toContain('part 2');
  });

  it('checks running numbers across the part boundary, and reads them from qa blocks too', async () => {
    const { numberingGates } = await import('@/lib/verify/categoryGates');
    const qa = (q: string) => ({ type: 'qa', q });
    const part1 = [{ blocks: [qa('Q47. A'), qa('Q48. B')] }];
    const part2 = [{ blocks: [qa('Q43. C'), qa('Q44. D')] }];
    const f = numberingGates(part2, 'drills', part1);
    expect(f.map((x) => x.summary)).toEqual(['Q43 follows Q48: numbering skips or repeats.']);
    expect(numberingGates([{ blocks: [qa('Q49. C')] }], 'drills', part1)).toEqual([]);
  });

  it('keeps the cover out of the count and out of the running numbers', async () => {
    const { itemRange } = await import('@/lib/handbookCategories');
    const { bookGates } = await import('@/lib/verify/categoryGates');
    const book = { title: '2 API Questions', summary: '', chapters: [
      { title: 'Cover', points: ['what is inside', 'who it is for'], shape: ['cover'] },
      { title: 'Basics', points: ['What is REST?', 'GET vs POST?'] },
    ] };
    expect(itemRange(book, 1)).toEqual({ from: 1, to: 2 });
    expect(bookGates(book, 'interview-qa')).toEqual([]);
    const ten = { title: '2 Concepts', summary: '', chapters: [
      { title: 'Cover', points: ['x'], shape: ['cover'] }, { title: 'A', points: ['a'] }, { title: 'B', points: ['b'] },
    ] };
    expect(bookGates(ten, 'listicle')).toEqual([]);
  });

  it('plans a cover page for the poster categories', async () => {
    const { categoryOf } = await import('@/lib/handbookCategories');
    for (const id of ['listicle', 'interview-qa', 'drills', 'system-design']) {
      expect(categoryOf(id).content.bookGuidance).toMatch(/first chapter is the cover/i);
    }
  });

  it('asks Q&A pages for qa blocks, which keep a question and its answer together', async () => {
    const { categoryOf } = await import('@/lib/handbookCategories');
    expect(categoryOf('interview-qa').presentation.pageRules).toContain('"qa" block');
  });

  it("applies a category's page template to item pages only, not the cover or intro pages", async () => {
    const { categoryPageRules } = await import('@/lib/ai/pages');
    const book = { title: 'Food Delivery', summary: '', chapters: [
      { title: 'Cover', points: ['x'], shape: ['cover'] },
      { title: 'Requirements', points: ['y'], shape: ['functional', 'non-functional', 'scale'] },
      { title: 'Order Service', points: ['z'], shape: ['responsibilities', 'high level design', 'data model', 'apis', 'failure scenarios', 'metrics'] },
    ] };
    const sd = 'system-design';
    expect(categoryPageRules(book as never, 0, sd)).not.toContain('Responsibilities;');
    expect(categoryPageRules(book as never, 1, sd)).not.toContain('Responsibilities;');
    expect(categoryPageRules(book as never, 2, sd)).toContain('Responsibilities;');
  });

  it('picks the topic word for the call to action, not a filler word', async () => {
    const { ctaKeyword } = await import('@/lib/ai/pages');
    expect(ctaKeyword('50 Most Asked API Interview Questions')).toBe('api');
    expect(ctaKeyword("10 Database Concepts You Can't Skip")).toBe('database');
    expect(ctaKeyword('System Design: Food Delivery App')).toBe('food');
    expect(ctaKeyword('Docker Complete Handbook')).toBe('docker');
  });

  it("tells the heading pass the other parts' titles, so a split chapter is not named twice", async () => {
    const { validatePost } = await import('@/lib/schema');
    const post = (titles: string[]) => validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
      slides: titles.map((page_title) => ({ page_title, blocks: [{ type: 'heading', text: 'x' }] })),
      caption: { text: '', hashtags: [] },
    });
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(post(['Cart and Checkout: Pricing', 'Payments'])));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('sd');
    await createChapter('sd', 'food');
    await savePost('sd', 'food', 1, post(['Intro', 'Cart and Checkout']));
    await savePost('sd', 'food', 2, post(['Cart and Checkout (cont.)', 'Payments']));
    const { fixHeadings } = await import('@/lib/ai/headings');
    await fixHeadings('sd', 'food', 2);
    expect(String(runClaude.mock.calls[0][0])).toMatch(/other parts[^\n]*\n[\s\S]*Cart and Checkout/i);
  });
});
