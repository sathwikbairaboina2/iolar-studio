import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pub-')); });
const put = (rel: string, v: unknown) => { const f = path.join(process.env.IOLAR_DATA_DIR!, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };

describe('chapterHash', () => {
  it('changes when a part or the book changes, not otherwise', async () => {
    put('handbooks/s/c/book.json', { title: 't', summary: 's', chapters: [] });
    put('handbooks/s/c/parts/01/post.json', { slides: [1] });
    const { chapterHash } = await import('@/lib/publish/hash');
    const a = await chapterHash('s', 'c');
    expect(await chapterHash('s', 'c')).toBe(a);
    put('handbooks/s/c/parts/01/post.json', { slides: [2] });
    expect(await chapterHash('s', 'c')).not.toBe(a);
  });
});
