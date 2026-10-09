import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.setConfig({ testTimeout: 60_000 });

const bullets = (n: number, word: string) => ({ type: 'bullets', items: Array.from({ length: n }, (_, i) => `${word} point number ${i + 1}`) });

// The fake renderer: a page needs 40% per block, so 4 blocks is 160% and 2 blocks is 80%.
const measure = vi.fn(async (post: { slides: { blocks: unknown[]; kind?: string }[] }) =>
  post.slides.map((s, i) => ({ slide: i + 1, neededPct: s.kind === 'cover' ? 300 : s.blocks.length * 40 })));

const long = (title: string) => ({ page_title: title, blocks: [bullets(2, 'alpha'), bullets(2, 'bravo'), bullets(2, 'charlie'), bullets(2, 'delta')] });
// The same teaching, merged into one block: 40%.
const fitted = (title: string) => ({ page_title: title, blocks: [{ type: 'bullets', items: ['alpha', 'bravo', 'charlie', 'delta'].flatMap((w) => [1, 2].map((n) => `${w} point number ${n}`)) }] });

let runClaude: ReturnType<typeof vi.fn>;

async function setup(slides: unknown[], category?: 'drills') {
  const { validatePost } = await import('@/lib/schema');
  const post = validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides, caption: { text: '', hashtags: [] },
  });
  const { createSubject, createChapter, savePost } = await import('@/lib/store');
  await createSubject('db');
  await createChapter('db', 'ten', 'Ten', category);
  await savePost('db', 'ten', 1, post);
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-fit-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
  measure.mockClear();
  runClaude = vi.fn();
  vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
});

describe('fitPlannedPages', () => {
  it('condenses an over-long page, says it spills, and saves the result', async () => {
    await setup([long('One'), { page_title: 'Two', blocks: [bullets(2, 'echo')] }]);
    runClaude.mockResolvedValue(JSON.stringify(fitted('One')));
    const { fitPlannedPages } = await import('@/lib/ai/plan');
    const out = await fitPlannedPages('db', 'ten', 1, measure);
    expect(out.condensed).toBe(1);
    expect(out.failed).toBe(0);
    expect(runClaude).toHaveBeenCalledTimes(1);
    expect(String(runClaude.mock.calls[0][0])).toContain('spills onto a second page');
    const { loadPost } = await import('@/lib/store');
    expect((await loadPost('db', 'ten', 1)).slides[0].blocks).toHaveLength(1);
  });

  it('keeps nothing when the proposal measures worse', async () => {
    await setup([long('One')]);
    runClaude.mockResolvedValue(JSON.stringify({ page_title: 'One', blocks: [bullets(2, 'alpha'), bullets(2, 'bravo'), bullets(2, 'charlie'), bullets(2, 'delta'), bullets(2, 'echo')] }));
    const { fitPlannedPages } = await import('@/lib/ai/plan');
    const out = await fitPlannedPages('db', 'ten', 1, measure);
    expect(out.condensed).toBe(0);
    expect(out.failed).toBe(1);
    const { loadPost } = await import('@/lib/store');
    expect((await loadPost('db', 'ten', 1)).slides[0].blocks).toHaveLength(4);
  });

  it('skips a cover and makes no AI call for a page already within 100%', async () => {
    await setup([
      { page_title: 'Cover', kind: 'cover', cover: { title: 'T' }, blocks: [] },
      { page_title: 'Fine', blocks: [bullets(2, 'alpha')] },
    ]);
    const { fitPlannedPages } = await import('@/lib/ai/plan');
    const out = await fitPlannedPages('db', 'ten', 1, measure);
    expect(out).toMatchObject({ condensed: 0, failed: 0 });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('renumbers the items of a drills chapter once the pages are fitted', async () => {
    await setup([{ page_title: 'Basics (Q7-8)', blocks: [{ type: 'heading', text: 'Q7. A' }, { type: 'heading', text: 'Q8. B' }] }], 'drills');
    const { fitPlannedPages } = await import('@/lib/ai/plan');
    const out = await fitPlannedPages('db', 'ten', 1, measure);
    expect(out.post.slides[0].page_title).toBe('Basics (Q1-2)');
    expect(out.post.slides[0].blocks[1]).toMatchObject({ text: 'Q2. B' });
  });
});
