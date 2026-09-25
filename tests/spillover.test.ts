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
    const titles = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `P${from + i}`);
    // Part 2 lost P21-P25 to part 3, so its caption stops promising them.
    expect((await loadPost('s', 'c', 2)).caption.text).toBe(`Hook. Part 2 of S covers ${titles(11, 19).join(', ')} and P20.`);
    expect((await loadPost('s', 'c', 3)).caption.text).toBe('Hook. Part 3 of S covers P21, P22, P23, P24 and P25.');
  });

  it('opens a follow-up caption on the hook and describes only its own pages', async () => {
    const { createSubject, createChapter, createPart, loadPost } = await import('@/lib/store');
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    await createSubject('s', { name: 'S' });
    await createChapter('s', 'c', 'C');
    const slides = post(12).slides.map((s, i) => (i === 11 ? { ...s, page_title: 'P11 (cont.)', cont: true } : s));
    await createPart('s', 'c', 1, { ...post(12), slides, caption: {
      text: '`depends_on` does not mean ready — it means started. This 8-page handbook goes keyword by keyword. Ten pages of notes.',
      hashtags: ['#x'],
    } } as never);
    await splitIntoFollowUp('s', 'c', 1);
    const cap = (await loadPost('s', 'c', 2)).caption;
    // The whole-handbook summary stays with part 1; a continuation title is named once.
    expect(cap.text).toBe('`depends_on` does not mean ready — it means started. Part 2 of S covers P11.');
    expect(cap.hashtags).toEqual(['#x']);
  });

  it('reads the hook out of a caption written in the old "Part N of X." form', async () => {
    const { followUpCaption } = await import('@/lib/ai/spillover');
    expect(followUpCaption('Part 2 of S. Hook here! Rest of the book.', 'S', 3, ['A', 'B'])).toBe('Hook here! Part 3 of S covers A and B.');
    expect(followUpCaption('', 'S', 2, ['A'])).toBe('Part 2 of S covers A.');
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
