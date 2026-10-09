import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

const base = { brand: 'iolar', template: 'notebook', ratio: '3:4' as const, seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] } };
const post = (slides: unknown[]): Post => validatePost({ ...base, slides });

describe('renumberItems', () => {
  it('numbers concept blocks in page order from start (round 5 read 1,3,3,4,6,...)', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const old = [1, 3, 3, 4, 6, 7, 8, 9, 9, 11];
    const p = post(old.map((n, i) => ({ page_title: `C${i}`, blocks: [{ type: 'concept', number: n, title: `Concept ${i}` }, { type: 'paragraph', text: 'x' }] })));
    const out = renumberItems(p, 1);
    expect(out.post.slides.map((s) => (s.blocks[0] as { number: number }).number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out.next).toBe(11);
  });

  it('renumbers drills Q7..Q66 to Q1..Q60 and rewrites ranges in page titles', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const nums = Array.from({ length: 60 }, (_, i) => i + 7);
    const slide = (title: string, ns: number[]) => ({ page_title: title, blocks: ns.map((n) => ({ type: 'heading', text: `Q${n}. Task ${n}` })) });
    const p = post([slide('Basics (Q7-14)', nums.slice(0, 8)), slide('Filtering (Q15–20)', nums.slice(8, 14)), slide('Rest', nums.slice(14))]);
    const out = renumberItems(p, 1);
    const heads = out.post.slides.flatMap((s) => s.blocks.map((b) => (b as { text: string }).text));
    expect(heads[0]).toBe('Q1. Task 7');
    expect(heads[59]).toBe('Q60. Task 66');
    expect(out.post.slides[0].page_title).toBe('Basics (Q1-8)');
    expect(out.post.slides[1].page_title).toBe('Filtering (Q9–14)');
    expect(out.next).toBe(61);
  });

  it('numbers qa questions and keeps a repeated old number on one new number', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const p = post([{ page_title: 'API (Q3-4)', blocks: [
      { type: 'qa', q: 'Q3. What is REST?', a_bullets: ['a'] },
      { type: 'qa', q: 'Q4. What is gRPC?', a_bullets: ['b'] },
    ] }]);
    const out = renumberItems(p, 5);
    expect(out.post.slides[0].blocks.map((b) => (b as { q: string }).q)).toEqual(['Q5. What is REST?', 'Q6. What is gRPC?']);
    expect(out.post.slides[0].page_title).toBe('API (Q5-6)');
  });

  it('moves a "Q29 again" heading to the new number of Q29', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const p = post([{ page_title: 'P', blocks: [{ type: 'heading', text: 'Q29. Filter' }, { type: 'heading', text: 'Q29 again with CASE' }] }]);
    const out = renumberItems(p, 1);
    expect(out.post.slides[0].blocks.map((b) => (b as { text: string }).text)).toEqual(['Q1. Filter', 'Q1 again with CASE']);
    expect(out.next).toBe(2);
  });

  it('removes a range from a page with no items, with its brackets (round 6 read "Window Functions (Q18-17)")', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const p = post([
      { page_title: 'Basics (Q1-2)', blocks: [{ type: 'heading', text: 'Q1. A' }, { type: 'heading', text: 'Q2. B' }] },
      { page_title: 'Window Functions (Q18-17)', blocks: [{ type: 'paragraph', text: 'no items here' }] },
    ]);
    const out = renumberItems(p, 1);
    expect(out.post.slides[1].page_title).toBe('Window Functions');
  });

  it('measures the range from the page: items Q5-Q9 give "(Q5-9)" whatever the model wrote', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const heads = [5, 6, 7, 8, 9].map((n) => ({ type: 'heading', text: `Q${n}. T${n}` }));
    const out = renumberItems(post([{ page_title: 'CTEs (Q2-40)', blocks: heads }]), 5);
    expect(out.post.slides[0].page_title).toBe('CTEs (Q5-9)');
  });

  it('leaves a post without items untouched', async () => {
    const { renumberItems } = await import('@/lib/ai/numbering');
    const p = post([{ page_title: 'Plain', blocks: [{ type: 'heading', text: '1. Intro' }] }]);
    const out = renumberItems(p, 1);
    expect(out.post).toEqual(p);
    expect(out.next).toBe(1);
  });
});

describe('applyNumbering', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-num-'));
    vi.resetModules();
  });

  it('continues part 2 from the last number of part 1', async () => {
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'drills', 'Drills', 'drills');
    const slide = (ns: number[]) => ({ page_title: 'P', blocks: ns.map((n) => ({ type: 'heading', text: `Q${n}. T` })) });
    await savePost('db', 'drills', 1, post([slide([1, 2, 3, 4])]));
    await savePost('db', 'drills', 2, post([slide([9, 10, 11])]));
    const { applyNumbering } = await import('@/lib/ai/numbering');
    const out = await applyNumbering('db', 'drills', 2);
    expect(out.slides[0].blocks.map((b) => (b as { text: string }).text)).toEqual(['Q5. T', 'Q6. T', 'Q7. T']);
    const { loadPost } = await import('@/lib/store');
    expect((await loadPost('db', 'drills', 2)).slides[0].blocks[0]).toMatchObject({ text: 'Q5. T' });
  });

  it('does not renumber a handbook chapter without concept blocks', async () => {
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'hb', 'HB', 'handbook');
    const p = post([{ page_title: 'P', blocks: [{ type: 'heading', text: 'Q9. keep' }] }]);
    await savePost('db', 'hb', 1, p);
    const { applyNumbering } = await import('@/lib/ai/numbering');
    const out = await applyNumbering('db', 'hb', 1);
    expect(out.slides[0].blocks[0]).toMatchObject({ text: 'Q9. keep' });
  });
});
