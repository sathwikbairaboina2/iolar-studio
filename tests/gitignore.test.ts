import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

/** `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not. */
const ignored = (p: string) => {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: process.cwd() });
    return true;
  } catch {
    return false;
  }
};

describe('data/ ignore rules', () => {
  it('tracks the authoring json', () => {
    expect(ignored('data/handbooks/python/decorators/parts/01/post.json')).toBe(false);
    expect(ignored('data/handbooks/python/decorators/book.json')).toBe(false);
    expect(ignored('data/handbooks/python/decorators/chapter.json')).toBe(false);
    expect(ignored('data/handbooks/python/subject.json')).toBe(false);
  });

  it('keeps the renders and everything else out', () => {
    expect(ignored('data/handbooks/python/decorators/parts/01/renders/slide-01.png')).toBe(true);
    expect(ignored('data/handbooks/python/decorators/parts/01/export/pack.zip')).toBe(true);
    expect(ignored('data/reel/anything.json')).toBe(true);
  });
});
