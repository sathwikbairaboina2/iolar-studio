import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function post(n: number) {
  return {
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: Array.from({ length: n }, (_, i) => ({ page_title: `P${i + 1}`, blocks: [{ type: 'heading', text: `H${i + 1}` }] })),
    caption: { text: 'c', hashtags: [] },
  };
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-spill-'));
});

describe('splitIntoFollowUp', () => {
  it('moves the surplus into a follow-up part marked with its origin', async () => {
    const { createSubject, createChapter, createPart, loadPost, listParts } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    await createPart('s', 'c', 1, post(13) as never);
    const r = await splitIntoFollowUp('s', 'c', 1);
    expect(r).toEqual({ moved: 3, part: 2 });
    expect((await loadPost('s', 'c', 1)).slides.length).toBe(10);
    const follow = await loadPost('s', 'c', 2);
    expect(follow.slides.map((s) => s.page_title)).toEqual(['P11', 'P12', 'P13']);
    expect(follow.spilledFrom).toBe(1);
    expect(await listParts('s', 'c')).toEqual([1, 2]);
  });

  it('a second spill from the same part overwrites its follow-up instead of adding part 3', async () => {
    const { createSubject, createChapter, createPart, savePost, loadPost, listParts } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    await createPart('s', 'c', 1, post(13) as never);
    await splitIntoFollowUp('s', 'c', 1);
    // Re-planned: part 1 grows again and re-renders.
    await savePost('s', 'c', 1, post(14) as never);
    const r = await splitIntoFollowUp('s', 'c', 1);
    expect(r).toEqual({ moved: 4, part: 2 });
    expect(await listParts('s', 'c')).toEqual([1, 2]);
    expect((await loadPost('s', 'c', 2)).slides.length).toBe(4);
  });

  it('a smaller re-spill keeps chapters the follow-up already held', async () => {
    const { createSubject, createChapter, createPart, savePost, loadPost } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    await createPart('s', 'c', 1, post(13) as never);
    await splitIntoFollowUp('s', 'c', 1); // part 2 now holds P11, P12, P13
    // Part 1 re-rendered denser: it still holds P1-P10 plus only P11 over the limit.
    await savePost('s', 'c', 1, post(11) as never);
    const r = await splitIntoFollowUp('s', 'c', 1);
    expect(r).toEqual({ moved: 1, part: 2 });
    expect((await loadPost('s', 'c', 2)).slides.map((x) => x.page_title)).toEqual(['P11', 'P12', 'P13']);
  });

  it('does not stack part prefixes on the caption when a follow-up spills again', async () => {
    const { createSubject, createChapter, createPart, loadPost } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    await createPart('s', 'c', 1, { ...post(25), caption: { text: 'Hook.', hashtags: [] } } as never);
    await splitIntoFollowUp('s', 'c', 1); // part 2 holds 15
    await splitIntoFollowUp('s', 'c', 2); // part 3 holds 5
    expect((await loadPost('s', 'c', 2)).caption.text).toBe('Part 2 of S. Hook.');
    expect((await loadPost('s', 'c', 3)).caption.text).toBe('Part 3 of S. Hook.');
  });

  it('never overwrites a part the user planned themselves', async () => {
    const { createSubject, createChapter, createPart, listParts } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    await createPart('s', 'c', 1, post(12) as never);
    await createPart('s', 'c', 2, post(3) as never); // hand-made, no spilledFrom
    const r = await splitIntoFollowUp('s', 'c', 1);
    expect(r?.part).toBe(3);
    expect(await listParts('s', 'c')).toEqual([1, 2, 3]);
  });
});
