import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.setConfig({ testTimeout: 60_000 });

const code = (word: string) => ({ type: 'code', lang: 'sql', lines: [`SELECT ${word} FROM employees`], result: { headers: ['a'], rows: [['1']] } });
const drillSlide = () => ({
  page_title: 'Filtering (Q1-3)',
  blocks: [
    { type: 'heading', text: 'Q1. Filter by salary' }, code('salary'),
    { type: 'heading', text: 'Q2. Filter by department' }, code('department'),
    { type: 'heading', text: 'Q3. Filter by manager' }, code('manager'),
  ],
});
const listicleSlide = () => ({
  page_title: 'Index',
  blocks: [
    { type: 'concept', number: 1, title: 'Index' },
    { type: 'labelrows', rows: [{ icon: 'search', label: 'What it is:', text: 'a lookup structure' }] },
    { type: 'bullets', items: ['btree balanced', 'selective columns'] },
  ],
});

async function setup(category: import('@/lib/handbookCategories').CategoryId, slide: unknown) {
  const { validatePost } = await import('@/lib/schema');
  const post = validatePost({
    brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: [slide], caption: { text: '', hashtags: [] },
  });
  const { createSubject, createChapter, savePost } = await import('@/lib/store');
  await createSubject('db');
  await createChapter('db', 'ch', 'Ch', category);
  await savePost('db', 'ch', 1, post);
}

const fit = () => vi.fn().mockResolvedValue([{ slide: 1, neededPct: 90 }]);
const mockClaude = (reply: unknown) => {
  const runClaude = vi.fn().mockResolvedValue(JSON.stringify(reply));
  vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
  return runClaude;
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cond-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

describe('condense keeps the category page', () => {
  it('rejects a proposal that turns three Q<n>. headings into one table', async () => {
    mockClaude({
      page_title: 'Filtering (Q1-3)',
      blocks: [{ type: 'heading', text: 'Q1. Filter by salary' }, code('salary'),
        { type: 'table', headers: ['task', 'sql'], rows: [['department', 'SELECT department FROM employees'], ['manager', 'SELECT manager FROM employees']] }],
    });
    await setup('drills', drillSlide());
    const { condenseSlide } = await import('@/lib/ai/plan');
    await expect(condenseSlide('db', 'ch', 1, 1, 130, fit())).rejects.toThrow(/Q<n>|numbered item|items/i);
  });

  it('accepts a proposal that keeps every Q<n>. item as its own heading', async () => {
    mockClaude(drillSlide());
    await setup('drills', drillSlide());
    const { condenseSlide } = await import('@/lib/ai/plan');
    const out = await condenseSlide('db', 'ch', 1, 1, 130, fit());
    expect(out.slides[0].blocks.filter((b) => b.type === 'heading')).toHaveLength(3);
  });

  it('rejects a proposal that drops the concept block', async () => {
    mockClaude({ page_title: 'Index', blocks: [
      { type: 'labelrows', rows: [{ icon: 'search', label: 'What it is:', text: 'a lookup structure' }] },
      { type: 'bullets', items: ['btree balanced', 'selective columns'] },
    ] });
    await setup('listicle', listicleSlide());
    const { condenseSlide } = await import('@/lib/ai/plan');
    await expect(condenseSlide('db', 'ch', 1, 1, 130, fit())).rejects.toThrow(/concept/i);
  });

  it('rejects a proposal that drops the labelrows block', async () => {
    mockClaude({ page_title: 'Index', blocks: [
      { type: 'concept', number: 1, title: 'Index' },
      { type: 'bullets', items: ['btree balanced', 'selective columns', 'lookup structure'] },
    ] });
    await setup('listicle', listicleSlide());
    const { condenseSlide } = await import('@/lib/ai/plan');
    await expect(condenseSlide('db', 'ch', 1, 1, 130, fit())).rejects.toThrow(/labelrows/i);
  });

  it('puts the category page rules and the template rule in a drills prompt, not a handbook one', async () => {
    const runClaude = mockClaude(drillSlide());
    await setup('drills', drillSlide());
    const { condenseSlide } = await import('@/lib/ai/plan');
    await condenseSlide('db', 'ch', 1, 1, 130, fit());
    const prompt = String(runClaude.mock.calls[0][0]);
    expect(prompt).toContain('Page title names the family and its range');
    expect(prompt).toContain("Keep this page's template");
    expect(prompt).toContain('Every \'Q<n>.\' item stays its own heading or qa block');

    vi.resetModules();
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cond-'));
    writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
    const hb = mockClaude(drillSlide());
    await setup('handbook', drillSlide());
    const mod = await import('@/lib/ai/plan');
    await mod.condenseSlide('db', 'ch', 1, 1, 130, fit());
    const hbPrompt = String(hb.mock.calls[0][0]);
    expect(hbPrompt).not.toContain("Keep this page's template");
    expect(hbPrompt).not.toContain('Page title names the family');
  });
});
