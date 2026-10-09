import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { bookGates, numberingGates } from '@/lib/verify/categoryGates';
import { isItemChapter } from '@/lib/handbookCategories';

const book = (title: string, chapters: { title: string; points: string[] }[]) => ({ title, summary: 's', chapters });

describe('category gates', () => {
  it('flags a page title used twice — the padding the source channel shipped', () => {
    const f = bookGates(book('DB concepts', [
      { title: 'Replication', points: ['a'] }, { title: 'Sharding', points: ['b'] }, { title: 'replication', points: ['c'] },
    ]), 'listicle');
    expect(f.map((x) => x.rule)).toContain('category.duplicate-title');
  });

  it('flags the same item taught twice across pages', () => {
    const f = bookGates(book('Q', [
      { title: 'Basics', points: ['What is a list?', 'What is a tuple?'] }, { title: 'More', points: ['what is a list'] },
    ]), 'interview-qa');
    expect(f.map((x) => x.rule)).toContain('category.duplicate-item');
  });

  it('flags a title count the book does not deliver', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `C${i}`, points: ['x', 'y'] }));
    // A listicle counts its pages: "10 concepts" must be ten concept pages.
    expect(bookGates(book('10 Database Concepts', items(11)), 'listicle').map((x) => x.rule)).toContain('category.count');
    expect(bookGates(book('10 Database Concepts', items(10)), 'listicle')).toEqual([]);
    // A question bank counts its items.
    const qa = book('5 API Questions', [{ title: 'p1', points: ['q1', 'q2', 'q3'] }, { title: 'p2', points: ['q4', 'q5'] }]);
    expect(bookGates(qa, 'interview-qa')).toEqual([]);
  });

  it('flags an item page holding more items than a page fits', () => {
    // Round 8: drills families of 7 tasks on pages that hold 6 left one task alone on a 25-46% page.
    const tasks = (n: number) => Array.from({ length: n }, (_, i) => `Task ${i + 1} on the family`);
    const over = book('13 SQL Queries', [{ title: 'Joins', points: tasks(7) }, { title: 'CTEs', points: tasks(6).map((t) => `${t} again`) }]);
    const f = bookGates(over, 'drills').filter((x) => x.rule === 'category.capacity');
    expect(f).toHaveLength(1);
    expect(f[0].summary).toContain('Joins');
    expect(bookGates(book('12 SQL Queries', [{ title: 'Joins', points: tasks(6) }, { title: 'CTEs', points: tasks(6).map((t) => `${t} again`) }]), 'drills')
      .filter((x) => x.rule === 'category.capacity')).toEqual([]);
  });

  it('counts the round-6 listicle book (generic shape roles) as 10 items, not 0', () => {
    const r6 = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'r6-db-concepts-book.json'), 'utf8'));
    expect(r6.chapters.filter((c: { shape?: string[] }) => isItemChapter('listicle', c, r6.chapters))).toHaveLength(10);
    expect(bookGates(r6, 'listicle').filter((f) => f.rule === 'category.count')).toEqual([]);
  });

  it('with no shared roles, a chapter is an item unless it only closes the book', () => {
    const generic = [{ shape: ['definition', 'mechanism'] }, { shape: ['cheatsheet'] }];
    expect(isItemChapter('listicle', generic[0], generic)).toBe(true);
    expect(isItemChapter('listicle', generic[1], generic)).toBe(false);
    expect(isItemChapter('listicle', { shape: ['summary', 'recap'] }, generic)).toBe(false);
    expect(isItemChapter('listicle', { shape: ['cover'] }, generic)).toBe(false);
    // Where other chapters do use the template's roles, one that shares none is an intro.
    const mixed = [{ shape: ['what it is', 'why it exists', 'used for', 'how it works'] }, { shape: ['definition'] }];
    expect(isItemChapter('listicle', mixed[1], mixed)).toBe(false);
  });

  it('leaves a classic handbook with no count alone', () => {
    expect(bookGates(book('Python asyncio', [{ title: 'A', points: ['x'] }, { title: 'B', points: ['y'] }]), 'handbook')).toEqual([]);
  });

  it('flags continuous numbering that skips or repeats across a part', () => {
    const slide = (heads: string[]) => ({ page_title: 't', blocks: heads.map((text) => ({ type: 'heading' as const, text })) });
    expect(numberingGates([slide(['Q1. A', 'Q2. B']), slide(['Q3. C'])], 'interview-qa')).toEqual([]);
    const f = numberingGates([slide(['Q1. A', 'Q2. B']), slide(['Q2. C', 'Q4. D'])], 'interview-qa');
    expect(f.map((x) => x.summary)).toEqual(['Q2 follows Q2: numbering skips or repeats.', 'Q4 follows Q2: numbering skips or repeats.']);
    // Chapter-numbered categories restart per page and are left to the heading checks.
    expect(numberingGates([slide(['1. A']), slide(['1. B'])], 'handbook')).toEqual([]);
  });
});
