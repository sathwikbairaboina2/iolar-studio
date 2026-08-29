import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
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
  vi.resetModules();
});

describe('mergeContinuations', () => {
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

    const { createPost } = await import('@/lib/store');
    await createPost('fit-demo', base());
    const { fitToPages } = await import('@/lib/ai/fit');
    await expect(fitToPages('fit-demo')).rejects.toThrow(/removed content/);
  });
});
