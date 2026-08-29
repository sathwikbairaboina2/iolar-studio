import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Post } from '@/lib/schema';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-spill-'));
});

const slide = (tag: string) => ({
  page_title: tag,
  blocks: [{ type: 'paragraph' as const, text: `content of ${tag}` }],
});

/** Creates the chapter once, then writes each part's pages. */
async function seed(parts: Record<number, string[]>, series = 'SPILL TEST') {
  const { createSubject, createChapter, createPart, loadPost, savePost } = await import('@/lib/store');
  await createSubject('k8s');
  await createChapter('k8s', 'pods', 'Pods');
  const base = await loadPost('k8s', 'pods', 1);
  for (const [n, tags] of Object.entries(parts)) {
    const post: Post = { ...base, series, slides: tags.map(slide) };
    if (Number(n) === 1) await savePost('k8s', 'pods', 1, post);
    else await createPart('k8s', 'pods', Number(n), post);
  }
}

const titles = (p: Post) => p.slides.map((s) => s.page_title);

describe('splitIntoFollowUp', () => {
  it('extends an existing follow-up part instead of overwriting it', async () => {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost, listParts } = await import('@/lib/store');

    // Part 1 renders to 12 pages (2 over the limit); part 2 already holds its own work.
    await seed({
      1: Array.from({ length: 12 }, (_, i) => `p1-${i + 1}`),
      2: ['p2-a', 'p2-b'],
    });

    const result = await splitIntoFollowUp('k8s', 'pods', 1, 10);

    expect(result).toEqual({ moved: 2, part: 2 });
    expect(await listParts('k8s', 'pods')).toEqual([1, 2]);
    expect(titles(await loadPost('k8s', 'pods', 1))).toHaveLength(10);
    // The surplus lands ahead of what part 2 already had, and nothing of part 2 is dropped.
    expect(titles(await loadPost('k8s', 'pods', 2))).toEqual(['p1-11', 'p1-12', 'p2-a', 'p2-b']);
  });

  it('cascades past a full follow-up rather than dropping its tail', async () => {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost, listParts } = await import('@/lib/store');

    await seed({
      1: Array.from({ length: 13 }, (_, i) => `p1-${i + 1}`),
      2: Array.from({ length: 9 }, (_, i) => `p2-${i + 1}`),
    });

    await splitIntoFollowUp('k8s', 'pods', 1, 10);

    expect(await listParts('k8s', 'pods')).toEqual([1, 2, 3]);
    const [one, two, three] = await Promise.all([
      loadPost('k8s', 'pods', 1),
      loadPost('k8s', 'pods', 2),
      loadPost('k8s', 'pods', 3),
    ]);
    expect(titles(one)).toHaveLength(10);
    expect(titles(two)).toEqual(['p1-11', 'p1-12', 'p1-13', 'p2-1', 'p2-2', 'p2-3', 'p2-4', 'p2-5', 'p2-6', 'p2-7']);
    expect(titles(three)).toEqual(['p2-8', 'p2-9']);
    // Every page that existed before the split still exists after it.
    expect([...titles(one), ...titles(two), ...titles(three)]).toHaveLength(22);
  });

  it('creates the follow-up when there is none, and leaves short parts alone', async () => {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost, listParts } = await import('@/lib/store');

    await seed({ 1: Array.from({ length: 11 }, (_, i) => `p1-${i + 1}`) });
    await splitIntoFollowUp('k8s', 'pods', 1, 10);

    expect(await listParts('k8s', 'pods')).toEqual([1, 2]);
    const two = await loadPost('k8s', 'pods', 2);
    expect(titles(two)).toEqual(['p1-11']);
    expect(two.series).toBe('SPILL TEST — PART 2');
    // A part inside the limit is not a split.
    expect(await splitIntoFollowUp('k8s', 'pods', 2, 10)).toBeNull();
  });

  it('never leaves a follow-up opening as a continuation page', async () => {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    const { loadPost } = await import('@/lib/store');

    const { createSubject, createChapter, savePost, loadPost: load } = await import('@/lib/store');
    await createSubject('k8s');
    await createChapter('k8s', 'pods', 'Pods');
    const base = await load('k8s', 'pods', 1);
    await savePost('k8s', 'pods', 1, {
      ...base,
      slides: Array.from({ length: 11 }, (_, i) => ({ ...slide(`p1-${i + 1}`), cont: true })),
    });

    await splitIntoFollowUp('k8s', 'pods', 1, 10);
    expect((await loadPost('k8s', 'pods', 2)).slides[0].cont).toBeUndefined();
  });
});
