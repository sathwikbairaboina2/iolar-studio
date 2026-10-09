import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// pullBack imports the renderer for its measure; under full-suite load that import alone can pass 30 s.
vi.setConfig({ testTimeout: 60_000 });

const bullets = (n: number, word: string) => ({ type: 'bullets', items: Array.from({ length: n }, (_, i) => `${word} point number ${i + 1}`) });

// Eight more distinct teaching words, so dropping one short paragraph stays under the word guard.
const words = { type: 'bullets', items: ['alpha bravo charlie delta', 'foxtrot hotel india juliet'] };

// A page and its thin spill: seven blocks between them.
const slides = () => [
  { page_title: 'Indexing', blocks: [{ type: 'heading', text: '1. What' }, bullets(3, 'btree'), bullets(2, 'pages')] },
  { page_title: 'Indexing (cont.)', cont: true, blocks: [bullets(2, 'composite'), bullets(2, 'covering'), words, { type: 'paragraph', text: 'selectivity decides' }] },
];

async function setup() {
  const { validatePost } = await import('@/lib/schema');
  const post = validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: slides(), caption: { text: '', hashtags: [] },
  });
  const { createSubject, createChapter, savePost } = await import('@/lib/store');
  await createSubject('db');
  await createChapter('db', 'ten');
  await savePost('db', 'ten', 1, post);
}

// A condensed page that keeps every word the pair teaches.
const kept = (extra = '') => ({
  page_title: 'Indexing',
  blocks: [{ type: 'heading', text: '1. What' }, bullets(3, 'btree'), bullets(2, 'pages'), bullets(2, 'composite'), bullets(2, 'covering'), words, { type: 'paragraph', text: `selectivity decides${extra}` }],
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-pull-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

const fit = (pct: number) => vi.fn().mockResolvedValue([{ slide: 1, neededPct: pct }]);

describe('pullBack block budget and re-measure', () => {
  it('tells the model how many blocks the pair may keep: floor(N * 92 / X)', async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(kept()));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    await pullBack('db', 'ten', 1, 2, 150, fit(95));
    const prompt = String(runClaude.mock.calls[0][0]);
    // 7 blocks needing 150% of a page: floor(7 * 92 / 150) = 4 blocks' worth.
    expect(prompt).toContain('7 blocks');
    expect(prompt).toContain('150%');
    expect(prompt).toContain('about 4 blocks');
    expect(prompt).toMatch(/merge bullets/i);
    expect(prompt).toMatch(/1-3 word cells/);
  });

  it('measures the proposal and does not ask again when it fits one page', async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(kept()));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    const measure = fit(97);
    const out = await pullBack('db', 'ten', 1, 2, 130, measure);
    expect(runClaude).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    // It measured the one slide, not the whole part.
    expect((measure.mock.calls[0][0] as { slides: unknown[] }).slides).toHaveLength(1);
    expect(out.slides).toHaveLength(1);
  });

  it('asks once more with the measured number when the first proposal still needs more than a page', async () => {
    const second = kept('. The tail is cut to one line');
    second.blocks.pop();
    second.blocks.push({ type: 'paragraph', text: 'selectivity decides' });
    const runClaude = vi.fn().mockResolvedValueOnce(JSON.stringify(kept())).mockResolvedValueOnce(JSON.stringify(second));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    const measure = vi.fn().mockResolvedValueOnce([{ slide: 1, neededPct: 118 }]).mockResolvedValueOnce([{ slide: 1, neededPct: 96 }]);
    const out = await pullBack('db', 'ten', 1, 2, 130, measure);
    expect(runClaude).toHaveBeenCalledTimes(2);
    const again = String(runClaude.mock.calls[1][0]);
    expect(again).toContain('118%');
    // The first proposal has 7 blocks: floor(7 * 92 / 118) = 5.
    expect(again).toContain('about 5 blocks');
    expect(out.slides).toHaveLength(1);
    expect(JSON.stringify(out.slides[0].blocks)).toBe(JSON.stringify(second.blocks));
  });

  it('asks only once more, even if the second proposal is still over', async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(kept()));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    const measure = fit(125);
    const out = await pullBack('db', 'ten', 1, 2, 130, measure);
    expect(runClaude).toHaveBeenCalledTimes(2);
    // The second proposal is taken as it comes: no third ask, no second measurement.
    expect(measure).toHaveBeenCalledTimes(1);
    expect(out.slides).toHaveLength(1);
  });

  it('keeps the first proposal when the second one drops material', async () => {
    const thin = { page_title: 'Indexing', blocks: [{ type: 'heading', text: '1. What' }, bullets(1, 'btree')] };
    const runClaude = vi.fn().mockResolvedValueOnce(JSON.stringify(kept())).mockResolvedValueOnce(JSON.stringify(thin));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    const out = await pullBack('db', 'ten', 1, 2, 130, vi.fn().mockResolvedValueOnce([{ slide: 1, neededPct: 120 }]));
    expect(runClaude).toHaveBeenCalledTimes(2);
    expect(out.slides[0].blocks).toHaveLength(7);
  });

  it('still rejects a first proposal that drops material', async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify({ page_title: 'Indexing', blocks: [{ type: 'heading', text: '1. What' }, bullets(1, 'btree')] }));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { pullBack } = await import('@/lib/ai/plan');
    const measure = fit(90);
    await expect(pullBack('db', 'ten', 1, 2, 130, measure)).rejects.toThrow(/dropped/);
    expect(measure).not.toHaveBeenCalled();
  });

  it('still rejects a proposal that drops a book point the pair taught', async () => {
    const lossy = kept();
    lossy.blocks.pop(); // the paragraph that taught "selectivity decides"
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(lossy));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup();
    const { saveBook } = await import('@/lib/ai/book');
    await saveBook('db', 'ten', { title: 'T', summary: 's', chapters: [{ title: 'Indexing', points: ['selectivity decides'] }] } as never);
    const { pullBack } = await import('@/lib/ai/plan');
    await expect(pullBack('db', 'ten', 1, 2, 130, fit(95))).rejects.toThrow(/book point/);
  });
});
