import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, Post } from '@/lib/schema';

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [
    { page_title: 'Lists', blocks: [{ type: 'heading', text: 'A' }] },
    { page_title: 'Lists (cont.)', blocks: [{ type: 'heading', text: 'B' }] },
  ],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-head-'));
  vi.resetModules();
});

describe('fixHeadings', () => {
  it('returns a proposal with rewritten titles and leaves disk untouched', async () => {
    const proposal = base();
    proposal.slides[1].page_title = 'Lists — Methods';
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createPost, loadPost } = await import('@/lib/store');
    await createPost('head', base());
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('head');

    expect(out.slides[1].page_title).toBe('Lists — Methods');
    expect((await loadPost('head')).slides[1].page_title).toBe('Lists (cont.)');
  });

  it('rejects a proposal that changes the slide count', async () => {
    const bad = base();
    bad.slides.push({ page_title: 'Extra', blocks: [{ type: 'heading', text: 'C' }] });
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(bad)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createPost } = await import('@/lib/store');
    await createPost('head2', base());
    const { fixHeadings } = await import('@/lib/ai/headings');
    await expect(fixHeadings('head2')).rejects.toThrow(/slide count/);
  });
});
