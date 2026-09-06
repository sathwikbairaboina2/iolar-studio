import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';
import { mergeContinuations } from '@/lib/renderer/capture';

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [
    { page_title: 'Lists', blocks: [{ type: 'heading', text: 'A' }, { type: 'paragraph', text: 'one' }] },
    { page_title: 'Lists (cont.)', cont: true, blocks: [{ type: 'paragraph', text: 'two' }] },
    { page_title: 'Sets', blocks: [{ type: 'heading', text: 'B' }] },
  ],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-fit-'));
  // These mock the Claude CLI, so the studio's provider switch is pinned to Claude here;
  // the local model has its own tests.
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude' }));
  vi.resetModules();
});

describe('mergeContinuations', () => {
  it('never merges into a cover page', () => {
    const merged = mergeContinuations(validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] },
      slides: [
        { page_title: 'c', kind: 'cover', blocks: [], cover: { title: 'C' } },
        { page_title: 'A (cont.)', cont: true, blocks: [{ type: 'paragraph', text: 'x' }] },
      ],
    }).slides);
    expect(merged.length).toBe(2);
    expect(merged[0].kind).toBe('cover');
  });

  it('merges only pages continuing the same chapter', () => {
    const merged = mergeContinuations(base().slides);
    expect(merged.map((s) => s.page_title)).toEqual(['Lists', 'Sets']);
    expect(merged[0].blocks.length).toBe(3);
  });

  it('leaves a post with no continuation flags untouched', () => {
    const post = base();
    post.slides = post.slides.map((s) => ({ ...s, cont: undefined }));
    expect(mergeContinuations(post.slides).length).toBe(3);
  });
});

describe('fitToPages guard', () => {
  it('rejects a proposal that removes blocks', async () => {
    const shrunk = base();
    shrunk.slides = mergeContinuations(shrunk.slides).map((s) => ({ ...s, blocks: [s.blocks[0]] }));

    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(shrunk)),
      ClaudeUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/renderer/capture', async () => {
      const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
      return { ...actual, renderSlide: vi.fn().mockResolvedValue({ overflowPx: 0, fillPct: 40, spillIndexes: [], neededPct: 40 }) };
    });

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'fit-demo');
    await savePost('python', 'fit-demo', 1, base());
    const { fitToPages } = await import('@/lib/ai/fit');
    await expect(fitToPages('python', 'fit-demo', 1)).rejects.toThrow(/removed content/);
  });
});

describe('uncoveredPoints counts diagram text', () => {
  it('a point taught inside a cards strip or a chain is covered', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    const book = { title: 't', summary: 's', chapters: [{ title: 'c', points: ['candidate key is a minimal super key', 'roles grant temporary permissions'] }] } as never;
    const post = base();
    post.slides[0].blocks = [
      { type: 'diagram', kind: 'chain', spec: { steps: [{ text: 'Candidate Key', note: 'minimal super key' }] } },
      { type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'Roles', text: 'grant temporary permissions', lines: [] }, { title: 'Users', lines: [] }] } },
    ] as never;
    expect(uncoveredPoints(book, post)).toEqual([]);
  });
});

describe('uncoveredPoints ignores inline markers', () => {
  it('a highlighted keyword still counts as covered', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    const book = { title: 't', summary: 's', chapters: [{ title: 'c', points: ['binary search needs a sorted array'] }] } as never;
    const post = base();
    post.slides[0].blocks = [{ type: 'paragraph', text: 'Binary search needs a ==sorted array== to __work__' }];
    expect(uncoveredPoints(book, post)).toEqual([]);
  });
});
