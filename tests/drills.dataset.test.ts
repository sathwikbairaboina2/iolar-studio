import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.setConfig({ testTimeout: 60_000 });

const dataset = { tables: [{ name: 'employees', columns: ['id', 'name', 'salary'], rows: [['1', 'Asha', '5000'], ['2', 'Ravi', '7000']] }] };
const book = (withDataset = true) => ({
  title: '60 SQL Queries', summary: 's',
  ...(withDataset ? { dataset } : {}),
  chapters: [
    { title: 'Schema', points: ['the schema'], shape: ['schema'] },
    { title: 'Filtering', points: ['Find rich employees'], shape: ['task', 'solution code', 'result'] },
  ],
});
const code = (word: string) => ({ type: 'code', lang: 'sql', lines: [`SELECT ${word} FROM employees`], result: { headers: ['a'], rows: [['1']] } });
const slide = () => ({ page_title: 'Filtering (Q1-2)', blocks: [{ type: 'heading', text: 'Q1. Rich employees' }, code('salary'), { type: 'heading', text: 'Q2. Names' }, code('name')] });

const mockClaude = (reply: unknown) => {
  const runClaude = vi.fn().mockResolvedValue(JSON.stringify(reply));
  vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
  return runClaude;
};

async function setup(category: import('@/lib/handbookCategories').CategoryId, withDataset = true) {
  const { validatePost } = await import('@/lib/schema');
  const { createSubject, createChapter, savePost } = await import('@/lib/store');
  await createSubject('db');
  await createChapter('db', 'ch', 'Ch', category);
  await savePost('db', 'ch', 1, validatePost({
    brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: [slide()], caption: { text: '', hashtags: [] },
  }));
  const { saveBook } = await import('@/lib/ai/book');
  await saveBook('db', 'ch', book(withDataset));
}

const RULE = 'Use ONLY these tables and rows. Every result is computed from exactly these rows; never invent names, ids or values.';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-ds-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

describe('one dataset for a drills chapter', () => {
  it('the book prompt for a drills chapter asks for the dataset; a handbook chapter\'s does not', async () => {
    const runClaude = mockClaude(book());
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'dr', 'Drills', 'drills');
    await createChapter('db', 'hb', 'Handbook', 'handbook');
    const { bookFromTopic } = await import('@/lib/ai/book');
    const saved = await bookFromTopic('db', 'dr', 'sql');
    expect(String(runClaude.mock.calls[0][0])).toContain('"dataset"');
    expect(saved.dataset?.tables[0].rows).toHaveLength(2);
    await bookFromTopic('db', 'hb', 'sql');
    expect(String(runClaude.mock.calls.at(-1)![0])).not.toContain('"dataset"');
  });

  it('the page prompt carries the dataset and the rule for drills, and nothing for other categories', async () => {
    await setup('drills');
    const { chapterPrompt } = await import('@/lib/ai/pages');
    const { loadBook } = await import('@/lib/ai/book');
    const b = (await loadBook('db', 'ch'))!;
    const opts = { brand: 'iolar', template: 'notebook', book: b, index: 1, prior: [] };
    const drills = chapterPrompt({ ...opts, category: 'drills' });
    expect(drills).toContain('employees(id, name, salary)');
    expect(drills).toContain('1 | Asha | 5000');
    expect(drills).toContain(RULE);
    for (const other of [undefined, 'handbook', 'interview-qa']) {
      expect(chapterPrompt({ ...opts, category: other }), String(other)).not.toContain(RULE);
    }
    const bare = { ...b, dataset: undefined };
    expect(chapterPrompt({ ...opts, book: bare, category: 'drills' })).not.toContain(RULE);
  });

  it('condense and densify prompts for a drills chapter include the dataset', async () => {
    const post = { brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd', slides: [slide()], caption: { text: '', hashtags: [] } };
    // One reply serves both: condense reads a slide, densify a whole post.
    const runClaude = vi.fn().mockImplementation(async (p: string) => JSON.stringify(p.includes('tightening') ? post : slide()));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    await setup('drills');
    const { condenseSlide, densifySlides } = await import('@/lib/ai/plan');
    await condenseSlide('db', 'ch', 1, 1, 130, vi.fn().mockResolvedValue([{ slide: 1, neededPct: 90 }]));
    expect(String(runClaude.mock.calls[0][0])).toContain(RULE);
    await densifySlides('db', 'ch', 1, [{ slide: 1, fillPct: 50 }]);
    expect(String(runClaude.mock.calls.at(-1)![0])).toContain('employees(id, name, salary)');
    expect(String(runClaude.mock.calls.at(-1)![0])).toContain(RULE);
  });

  it('a handbook chapter\'s condense prompt never mentions the dataset', async () => {
    const runClaude = mockClaude(slide());
    await setup('handbook');
    const { condenseSlide } = await import('@/lib/ai/plan');
    await condenseSlide('db', 'ch', 1, 1, 130, vi.fn().mockResolvedValue([{ slide: 1, neededPct: 90 }]));
    expect(String(runClaude.mock.calls[0][0])).not.toContain(RULE);
  });

  it('a book revision that omits the dataset keeps it', async () => {
    mockClaude(book(false));
    await setup('drills');
    const { reviseBook, loadBook } = await import('@/lib/ai/book');
    const revised = await reviseBook('db', 'ch', (await loadBook('db', 'ch'))!, 'rename');
    expect(revised.dataset).toEqual(dataset);
  });
});
