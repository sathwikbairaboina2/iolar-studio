import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
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
  // These mock the Claude CLI, so the studio's provider switch is pinned to Claude here;
  // the local model has its own tests.
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude' }));
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

    const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head');
    await savePost('python', 'head', 1, base());
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('python', 'head', 1);

    expect(out.slides[1].page_title).toBe('Lists — Methods');
    expect((await loadPost('python', 'head', 1)).slides[1].page_title).toBe('Lists (cont.)');
  });

  it('drops the continuation flag from a page it renamed, so the next render cannot merge it back', async () => {
    const proposal = base();
    proposal.slides[1].page_title = 'List Methods and Slicing';
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head3');
    const start = base();
    start.slides[1].cont = true;
    await savePost('python', 'head3', 1, start);
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('python', 'head3', 1);

    expect(out.slides[1].page_title).toBe('List Methods and Slicing');
    expect(out.slides[1].cont).toBeUndefined();
    const { mergeContinuations } = await import('@/lib/renderer/capture');
    expect(mergeContinuations(out.slides).length).toBe(2);
  });

  it('keeps the flag on a page it left as a continuation', async () => {
    const proposal = base();
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head4');
    const start = base();
    start.slides[1].cont = true;
    await savePost('python', 'head4', 1, start);
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('python', 'head4', 1);
    expect(out.slides[1].cont).toBe(true);
  });

  it('rejects a proposal that changes the slide count', async () => {
    const bad = base();
    bad.slides.push({ page_title: 'Extra', blocks: [{ type: 'heading', text: 'C' }] });
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(bad)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head2');
    await savePost('python', 'head2', 1, base());
    const { fixHeadings } = await import('@/lib/ai/headings');
    await expect(fixHeadings('python', 'head2', 1)).rejects.toThrow(/slide count/);
  });
});
