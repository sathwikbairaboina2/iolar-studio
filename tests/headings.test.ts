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

  it('moves a heading stranded at the foot of the page before onto the page it now names', async () => {
    const stranded = (): Post => validatePost({
      ...base(),
      slides: [
        { page_title: 'Lists', blocks: [{ type: 'bullets', items: ['a'] }, { type: 'heading', text: 'Symptom → Cause' }] },
        { page_title: 'Lists (cont.)', cont: true, blocks: [{ type: 'table', headers: ['S', 'C'], rows: [['x', 'y']] }] },
      ],
    });
    const proposal = stranded();
    proposal.slides[1].page_title = 'Symptoms and Causes';
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head5');
    await savePost('python', 'head5', 1, stranded());
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('python', 'head5', 1);

    // Once the flag goes, the two pages never reflow together again, so the heading must
    // cross now or it stays alone above blank space for good.
    expect(out.slides[0].blocks.map((b) => b.type)).toEqual(['bullets']);
    expect(out.slides[1].blocks.map((b) => b.type)).toEqual(['heading', 'table']);
  });

  it('renumbers the sections of a page that became its own chapter from 1', async () => {
    const carried = (): Post => validatePost({
      ...base(),
      slides: [
        { page_title: 'Tools', blocks: [{ type: 'heading', text: '1. A' }, { type: 'heading', text: '3. C' }, { type: 'bullets', items: ['c'] }] },
        { page_title: 'Tools (cont.)', cont: true, blocks: [
          { type: 'heading', text: '4. Which One? Decision Rule' }, { type: 'bullets', items: ['x'] }, { type: 'heading', text: '5. Migrating' },
        ] },
      ],
    });
    const proposal = carried();
    proposal.slides[1].page_title = 'Picking a Class Tool';
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'head6');
    await savePost('python', 'head6', 1, carried());
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('python', 'head6', 1);

    // The page is a chapter of its own now; "4." under a fresh title reads as missing pages.
    const heads = (i: number) => out.slides[i].blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : []));
    expect(heads(1)).toEqual(['1. Which One? Decision Rule', '2. Migrating']);
    expect(heads(0)).toEqual(['1. A', '3. C']);
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
