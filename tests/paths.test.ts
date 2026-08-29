import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { isSlug, slugify, partName, subjectDir, chapterDir, partDir, postFile, bookFile } from '@/lib/paths';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-paths-'));
});

describe('slugs', () => {
  it('validates slugs', () => {
    expect(isSlug('python-3')).toBe(true);
    expect(isSlug('Python 3')).toBe(false);
    expect(isSlug('')).toBe(false);
  });

  it('slugifies titles', () => {
    expect(slugify('Data Structures — Deep Dive!')).toBe('data-structures-deep-dive');
    expect(slugify('  SQL   Joins  ')).toBe('sql-joins');
  });

  it('pads part names', () => {
    expect(partName(1)).toBe('01');
    expect(partName(12)).toBe('12');
  });
});

describe('paths', () => {
  it('nests subject / chapter / part correctly', () => {
    const root = process.env.IOLAR_DATA_DIR!;
    expect(subjectDir('python')).toBe(path.join(root, 'handbooks', 'python'));
    expect(chapterDir('python', 'lists')).toBe(path.join(root, 'handbooks', 'python', 'lists'));
    expect(partDir('python', 'lists', 2)).toBe(path.join(root, 'handbooks', 'python', 'lists', 'parts', '02'));
    expect(postFile('python', 'lists', 2)).toBe(path.join(partDir('python', 'lists', 2), 'post.json'));
    expect(bookFile('python', 'lists')).toBe(path.join(chapterDir('python', 'lists'), 'book.json'));
  });
});
