import { describe, it, expect } from 'vitest';
import { CATEGORIES, categoryOf, isCategoryId, itemRange, filterChapters, isLabelCover } from '@/lib/handbookCategories';

describe('handbook categories', () => {
  it('ships the five researched categories, each with all three rule layers', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['handbook', 'interview-qa', 'listicle', 'system-design', 'drills']);
    for (const c of CATEGORIES) {
      expect(c.content.bookGuidance.length).toBeGreaterThan(20);
      expect(c.content.pageShape.length).toBeGreaterThan(0);
      expect(c.presentation.pageRules.length).toBeGreaterThan(20);
      expect(c.script.caption.length).toBeGreaterThan(10);
      expect(c.script.cta).toContain('{keyword}');
      expect(c.script.narration.length).toBeGreaterThan(0);
    }
  });

  it('reads an unknown or missing category as the classic handbook', () => {
    expect(categoryOf(undefined).id).toBe('handbook');
    expect(categoryOf('nope').id).toBe('handbook');
    expect(categoryOf('listicle').id).toBe('listicle');
    expect(isCategoryId('drills')).toBe(true);
    expect(isCategoryId('x')).toBe(false);
  });

  it('gives a continuously numbered page the item range after the pages before it', () => {
    const book = { chapters: [{ points: ['a', 'b', 'c'] }, { points: ['d', 'e'] }, { points: ['f'] }] };
    expect(itemRange(book, 0)).toEqual({ from: 1, to: 3 });
    expect(itemRange(book, 1)).toEqual({ from: 4, to: 5 });
    expect(itemRange(book, 2)).toEqual({ from: 6, to: 6 });
  });

  it('filters the chapter list by category, status and title', () => {
    const list = [
      { title: 'Indexing', category: 'listicle', status: 'draft' },
      { title: 'Python Q&A', category: 'interview-qa', status: 'published' },
      { title: 'Asyncio', status: 'published' },
    ];
    expect(filterChapters(list, { category: 'handbook' }).map((c) => c.title)).toEqual(['Asyncio']);
    expect(filterChapters(list, { status: 'published' }).map((c) => c.title)).toEqual(['Python Q&A', 'Asyncio']);
    expect(filterChapters(list, { query: 'q&a' }).map((c) => c.title)).toEqual(['Python Q&A']);
    expect(filterChapters(list, {}).length).toBe(3);
  });
});

describe('caption prompts', () => {
  it('uses the chapter\'s own count, not the example in the category script', async () => {
    const { captionPrompt } = await import('@/lib/ai/pages');
    const book = { title: '60 SQL Queries on PostgreSQL', summary: 's', chapters: [{ title: 'Basics', points: ['p'] }] };
    const prompt = captionPrompt(book, 'iolar', 'drills');
    expect(prompt).not.toContain('300');
    expect(prompt).toContain('60 SQL Queries');
    expect(prompt).toContain('<count>');
  });

  it('carries no literal example topic or number in any category caption', async () => {
    const { CATEGORIES } = await import('@/lib/handbookCategories');
    for (const c of CATEGORIES) expect(c.script.caption, c.id).not.toMatch(/\b\d{2,}\b|Docker|Swiggy|API questions/);
  });
});

describe('isLabelCover', () => {
  it('is true only for a cover whose points are short labels', () => {
    expect(isLabelCover({ shape: ['cover'], points: ['Docker Compose', 'One YAML file'] })).toBe(true);
    expect(isLabelCover({ shape: ['cover'], points: ['Each instruction in a Dockerfile creates one cached image layer'] })).toBe(false);
    expect(isLabelCover({ points: ['Docker Compose'] })).toBe(false);
  });
});
