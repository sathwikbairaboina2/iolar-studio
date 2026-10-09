import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const section = (title: string) => JSON.stringify({ title, pages: [{ title: `${title} page`, blocks: [{ type: 'paragraph', text: `About ${title}` }] }] });
const editionPath = () => path.join(root, 'handbooks/py/loop/digital/edition.json');

class Unavailable extends Error { constructor() { super('no claude'); this.name = 'ClaudeUnavailableError'; } }

function mockClaude(answer: (prompt: string, n: number) => string | Promise<string>) {
  const runClaude = vi.fn();
  let n = 0;
  runClaude.mockImplementation(async (p: string) => answer(p, n++));
  vi.doMock('@/lib/ai/claude', async (orig) => ({ ...(await orig<object>()), runClaude }));
  return runClaude;
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/ai/claude');
  root = mkdtempSync(path.join(tmpdir(), 'gen-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'd' });
  put('handbooks/py/loop/chapter.json', { title: 'Loop', order: 0 });
  put('handbooks/py/loop/book.json', {
    title: 'Loop', summary: 'About loops',
    chapters: [{ title: 'Alpha', points: ['alpha point one', 'alpha point two'] }, { title: 'Beta', points: ['beta point one'] }],
  });
  put('handbooks/py/loop/parts/01/post.json', { brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Carousel title', blocks: [{ type: 'paragraph', text: 'carousel **words** here' }] }] });
});

const titleOf = (p: string) => (/Write the INTRODUCTION/.test(p) ? 'Introduction' : /QUIZ AND SUMMARY/.test(p) ? 'Check yourself' : /section "Alpha"/.test(p) ? 'Alpha' : 'Beta');

describe('generateEdition', () => {
  it('writes intro, each outline section in order, then the quiz, and saves with the inputs hash', async () => {
    mockClaude((p) => section(titleOf(p)));
    const { generateEdition } = await import('@/lib/digital/generate');
    const { inputsHash, loadEdition } = await import('@/lib/digital/edition');
    const e = await generateEdition('py', 'loop');
    expect(e.sections.map((s) => [s.role, s.title])).toEqual([['intro', 'Introduction'], ['outline', 'Alpha'], ['outline', 'Beta'], ['quiz', 'Check yourself']]);
    expect(e.sections[2].outlineIndex).toBe(1);
    expect(existsSync(editionPath())).toBe(true);
    expect((await loadEdition('py', 'loop'))!.inputsHash).toBe(await inputsHash('py', 'loop'));
  });

  it('puts every point of the section and the carousel text in its prompt', async () => {
    const run = mockClaude((p) => section(titleOf(p)));
    const { generateEdition } = await import('@/lib/digital/generate');
    await generateEdition('py', 'loop');
    const alpha = run.mock.calls.map((c) => c[0] as string).find((p) => /section "Alpha"/.test(p))!;
    expect(alpha).toContain('alpha point one');
    expect(alpha).toContain('alpha point two');
    expect(alpha).toContain('carousel words here');
    expect(alpha).toContain('Carousel title');
    expect(alpha).not.toContain('beta point one');
  });

  it('retries once with the error when the first answer is not JSON', async () => {
    const prompts: string[] = [];
    let alphaCalls = 0;
    mockClaude((p) => {
      prompts.push(p);
      if (/section "Alpha"/.test(p) && alphaCalls++ === 0) return 'sorry, no JSON';
      return section(titleOf(p));
    });
    const { generateEdition } = await import('@/lib/digital/generate');
    const e = await generateEdition('py', 'loop');
    expect(e.sections[1].title).toBe('Alpha');
    const retry = prompts.filter((p) => /section "Alpha"/.test(p))[1];
    expect(retry).toContain('previous answer was rejected');
  });

  it('retries a block the contract rejects, then fails the section and writes nothing', async () => {
    const bad = JSON.stringify({ title: 'Beta', pages: [{ title: 'p', blocks: [{ type: 'table', headers: [], rows: [] }] }] });
    mockClaude((p) => (/section "Beta"/.test(p) ? bad : section(titleOf(p))));
    const { generateEdition } = await import('@/lib/digital/generate');
    await expect(generateEdition('py', 'loop')).rejects.toThrow(/section Beta/);
    expect(existsSync(editionPath())).toBe(false);
  });

  it('rejects with ClaudeUnavailableError and writes nothing', async () => {
    mockClaude(() => { throw new Unavailable(); });
    const { generateEdition } = await import('@/lib/digital/generate');
    await expect(generateEdition('py', 'loop')).rejects.toMatchObject({ name: 'ClaudeUnavailableError' });
    expect(existsSync(editionPath())).toBe(false);
  });

  it('generateSection appends notes to the prompt', async () => {
    const run = mockClaude((p) => section(titleOf(p)));
    const { generateSection } = await import('@/lib/digital/generate');
    const s = await generateSection('py', 'loop', { role: 'outline', outlineIndex: 0, notes: ['fix the first example'] });
    expect(s.title).toBe('Alpha');
    expect(run.mock.calls[0][0]).toContain('Fix these problems from the review');
    expect(run.mock.calls[0][0]).toContain('fix the first example');
  });
});
