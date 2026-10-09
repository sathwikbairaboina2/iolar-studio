import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const section = (title: string) => JSON.stringify({ title, pages: [{ title: `${title} page`, blocks: [{ type: 'paragraph', text: `About ${title}` }] }] });
const qa = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'qa', q: `Question ${i}?`, a_bullets: ['the answer'] }));
const quiz = (n = 3) => JSON.stringify({ title: 'Check yourself', pages: [{ title: 'Check yourself', blocks: qa(n) }] });
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

const titleOf = (p: string) => (/Write the QUIZ/.test(p) ? 'Check yourself' : /section "Alpha"/.test(p) ? 'Alpha' : 'Beta');
const answer = (p: string) => (titleOf(p) === 'Check yourself' ? quiz() : section(titleOf(p)));

describe('generateEdition', () => {
  it('writes one outline section per book section, each with one page, then the quiz, and no intro or summary', async () => {
    const run = mockClaude((p) => answer(p));
    const { generateEdition } = await import('@/lib/digital/generate');
    const { inputsHash, loadEdition } = await import('@/lib/digital/edition');
    const e = await generateEdition('py', 'loop');
    expect(e.sections.map((s) => [s.role, s.title])).toEqual([['outline', 'Alpha'], ['outline', 'Beta'], ['quiz', 'Check yourself']]);
    expect(e.sections.map((s) => s.pages.length)).toEqual([1, 1, 1]);
    expect(e.sections[1].outlineIndex).toBe(1);
    expect(e.sections.map((s) => s.pages[0].title)).toEqual(['Alpha', 'Beta', 'Check yourself']);
    expect(run.mock.calls).toHaveLength(3);
    expect(existsSync(editionPath())).toBe(true);
    expect((await loadEdition('py', 'loop'))!.inputsHash).toBe(await inputsHash('py', 'loop'));
  });

  it('puts every point of the section and the carousel text in its prompt', async () => {
    const run = mockClaude((p) => answer(p));
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
      return answer(p);
    });
    const { generateEdition } = await import('@/lib/digital/generate');
    const e = await generateEdition('py', 'loop');
    expect(e.sections[0].title).toBe('Alpha');
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
    const run = mockClaude((p) => answer(p));
    const { generateSection } = await import('@/lib/digital/generate');
    const s = await generateSection('py', 'loop', { role: 'outline', outlineIndex: 0, notes: ['fix the first example'] });
    expect(s.title).toBe('Alpha');
    expect(run.mock.calls[0][0]).toContain('Fix these problems from the review');
    expect(run.mock.calls[0][0]).toContain('fix the first example');
  });

  it('retries a section with two pages once with the rule stated, then fails', async () => {
    const two = (p: string) => JSON.stringify({ title: titleOf(p), pages: Array.from({ length: 2 }, (_, i) => ({ title: `p${i}`, blocks: [{ type: 'paragraph', text: 'x' }] })) });
    const run = mockClaude((p, n) => (n === 0 ? two(p) : answer(p)));
    const { generateSection } = await import('@/lib/digital/generate');
    const s = await generateSection('py', 'loop', { role: 'outline', outlineIndex: 0 });
    expect(s.pages).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toMatch(/has 2 pages; an outline section has exactly 1/);
    vi.resetModules();
    mockClaude((p) => two(p));
    const again = await import('@/lib/digital/generate');
    await expect(again.generateSection('py', 'loop', { role: 'outline', outlineIndex: 0 })).rejects.toThrow(/exactly 1/);
  });

  it('names the cap a page broke in the retry prompt, and saves no oversize page', async () => {
    const big = JSON.stringify({ title: 'Alpha', pages: [{ title: 'Alpha', blocks: Array.from({ length: 15 }, () => ({ type: 'bullets', items: ['x'] })) }] });
    const run = mockClaude((p, n) => (n === 0 ? big : answer(p)));
    const { generateSection } = await import('@/lib/digital/generate');
    expect((await generateSection('py', 'loop', { role: 'outline', outlineIndex: 0 })).pages[0].blocks).toHaveLength(1);
    expect(run.mock.calls[1][0]).toMatch(/Your previous answer was rejected: .*15 blocks; the most allowed is 14/);
    vi.resetModules();
    const fat = JSON.stringify({ title: 'Alpha', pages: [{ title: 'Alpha', blocks: [{ type: 'paragraph', text: 'p'.repeat(200) }] }] });
    mockClaude(() => fat);
    const again = await import('@/lib/digital/generate');
    await expect(again.generateEdition('py', 'loop')).rejects.toThrow(/paragraph of 200 characters; the most allowed is 160/);
    expect(existsSync(editionPath())).toBe(false);
  });

  it('asks for the quiz as one page of 3 to 5 questions', async () => {
    const run = mockClaude((p) => (titleOf(p) === 'Check yourself' ? quiz(6) : answer(p)));
    const { generateSection } = await import('@/lib/digital/generate');
    await expect(generateSection('py', 'loop', { role: 'quiz' })).rejects.toThrow(/3 to 5 qa blocks/);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toMatch(/rejected: .*6 qa blocks/);
    vi.resetModules();
    mockClaude((p) => (titleOf(p) === 'Check yourself' ? quiz(4) : answer(p)));
    const ok = await import('@/lib/digital/generate');
    const s = await ok.generateSection('py', 'loop', { role: 'quiz' });
    expect(s.title).toBe('Check yourself');
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0].blocks).toHaveLength(4);
  });

  it('writes the outline prompt as notes with the caps and two example pages', async () => {
    const run = mockClaude((p) => answer(p));
    const { generateSection } = await import('@/lib/digital/generate');
    await generateSection('py', 'loop', { role: 'outline', outlineIndex: 0 });
    const prompt = run.mock.calls[0][0] as string;
    expect(prompt).toMatch(/notes, not prose/i);
    expect(prompt).toMatch(/at most 14 blocks/);
    expect(prompt).toMatch(/at most 2 code blocks/);
    expect(prompt).toMatch(/at most 2 tables/);
    expect(prompt).toMatch(/at most 8 lines/);
    expect(prompt).toMatch(/at most 1 paragraph of at most 160 characters/);
    expect(prompt).toMatch(/at most 120 characters/);
    expect(prompt).toContain('"title":"The Event Loop"');
    expect(prompt).toContain('"title":"Awaitables: Coroutines, Tasks, Futures"');
    expect(prompt).not.toMatch(/Write the INTRODUCTION/);
  });

  it('puts the carousel pages that match the section in its prompt, else the whole carousel trimmed', async () => {
    put('handbooks/py/loop/parts/01/post.json', {
      brand: 'iolar', series: 's', date: 'd',
      slides: [
        { page_title: 'Alpha', blocks: [{ type: 'paragraph', text: 'alpha-only words' }] },
        { page_title: 'Zulu', blocks: [{ type: 'paragraph', text: 'zulu-only words' }] },
      ],
    });
    const run = mockClaude((p) => answer(p));
    const { generateEdition } = await import('@/lib/digital/generate');
    await generateEdition('py', 'loop');
    const prompts = run.mock.calls.map((c) => c[0] as string);
    const alpha = prompts.find((p) => /section "Alpha"/.test(p))!;
    expect(alpha).toContain('alpha-only words');
    expect(alpha).not.toContain('zulu-only words');
    const beta = prompts.find((p) => /section "Beta"/.test(p))!;
    expect(beta).toContain('alpha-only words');
    expect(beta).toContain('zulu-only words');
    vi.resetModules();
    put('handbooks/py/loop/parts/01/post.json', {
      brand: 'iolar', series: 's', date: 'd',
      slides: Array.from({ length: 40 }, (_, i) => ({ page_title: `Page ${i}`, blocks: [{ type: 'paragraph', text: `filler ${'w'.repeat(900)} END${i}` }] })),
    });
    const long = mockClaude((p) => answer(p));
    const again = await import('@/lib/digital/generate');
    await again.generateSection('py', 'loop', { role: 'outline', outlineIndex: 1 });
    const text = (long.mock.calls[0][0] as string).split('Source material')[1];
    expect(text).toContain('END0');
    expect(text).not.toContain('END39');
    expect(text.length).toBeLessThan(13_000);
  });

  it('regenerateWithNotes rewrites only the sections the notes name, or every outline section', async () => {
    const run = mockClaude((p) => answer(p));
    const { generateEdition, regenerateWithNotes } = await import('@/lib/digital/generate');
    await generateEdition('py', 'loop');
    run.mockClear();
    await regenerateWithNotes('py', 'loop', 'Beta needs a second example');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('section "Beta"');
    expect(run.mock.calls[0][0]).toContain('Beta needs a second example');
    run.mockClear();
    await regenerateWithNotes('py', 'loop', 'make it friendlier');
    expect(run.mock.calls.map((c) => titleOf(c[0] as string)).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('regenerateWithNotes writes the whole edition again when the inputs changed since it was written', async () => {
    const run = mockClaude((p) => answer(p));
    const { generateEdition, regenerateWithNotes } = await import('@/lib/digital/generate');
    const { inputsHash, loadEdition } = await import('@/lib/digital/edition');
    await generateEdition('py', 'loop');
    put('handbooks/py/loop/parts/01/post.json', { brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Carousel title', blocks: [{ type: 'paragraph', text: 'changed words' }] }] });
    run.mockClear();
    const e = await regenerateWithNotes('py', 'loop', 'Beta needs a second example');
    expect(run).toHaveBeenCalledTimes(3);
    expect(e.inputsHash).toBe(await inputsHash('py', 'loop'));
    expect((await loadEdition('py', 'loop'))!.inputsHash).toBe(e.inputsHash);
    expect(run.mock.calls.map((c) => c[0] as string).filter((p) => p.includes('Beta needs a second example'))).toHaveLength(2);
  });

  it('regenerateWithNotes writes the whole edition again when the saved one has an intro or a multi-page outline section', async () => {
    const run = mockClaude((p) => answer(p));
    const { regenerateWithNotes } = await import('@/lib/digital/generate');
    const { inputsHash } = await import('@/lib/digital/edition');
    const page = (t: string) => ({ title: t, blocks: [{ type: 'paragraph', text: 'x' }] });
    put('handbooks/py/loop/digital/edition.json', {
      schema: 1, subject: 'py', chapter: 'loop', inputsHash: await inputsHash('py', 'loop'), generatedAt: '2026-10-09T00:00:00.000Z',
      sections: [
        { title: 'Introduction', role: 'intro', pages: [page('i')] },
        { title: 'Alpha', role: 'outline', outlineIndex: 0, pages: [page('a1'), page('a2')] },
        { title: 'Beta', role: 'outline', outlineIndex: 1, pages: [page('b')] },
        { title: 'Check yourself', role: 'quiz', pages: [page('q')] },
      ],
    });
    const e = await regenerateWithNotes('py', 'loop', 'Beta needs a second example');
    expect(run).toHaveBeenCalledTimes(3);
    expect(e.sections.map((x) => x.role)).toEqual(['outline', 'outline', 'quiz']);
  });

  it('keeps the example pages in the prompt inside the caps', async () => {
    const { EXAMPLE_PAGES } = await import('@/lib/digital/examples');
    const { pageCapErrors } = await import('@/lib/digital/edition');
    expect(EXAMPLE_PAGES).toHaveLength(2);
    for (const p of EXAMPLE_PAGES) expect(pageCapErrors(p as never)).toEqual([]);
  });

  it('regenerateWithNotes writes a whole edition when none exists', async () => {
    const run = mockClaude((p) => answer(p));
    const { regenerateWithNotes } = await import('@/lib/digital/generate');
    const e = await regenerateWithNotes('py', 'loop', 'be brief');
    expect(e.sections).toHaveLength(3);
    expect(run.mock.calls.map((c) => c[0] as string).filter((p) => p.includes('be brief'))).toHaveLength(2);
  });

  it('reads the first JSON object when prose or a second object follows it', async () => {
    const wrapped = (p: string) => answer(p) + '\n\nHope that helps! {"note": "extra"}';
    mockClaude((p) => wrapped(p));
    const { generateEdition } = await import('@/lib/digital/generate');
    const e = await generateEdition('py', 'loop');
    expect(e.sections.map((s) => s.title)).toEqual(['Alpha', 'Beta', 'Check yourself']);
  });

  it('turns a block written with the diagram kind as its type into a diagram block', async () => {
    const flow = { type: 'flow', nodes: [{ text: 'A' }, { text: 'B' }] };
    const withFlow = (p: string) => JSON.stringify({ title: titleOf(p), pages: [{ title: 'p', blocks: [{ type: 'paragraph', text: 'x' }, flow] }] });
    mockClaude((p) => (titleOf(p) === 'Check yourself' ? quiz() : withFlow(p)));
    const { generateEdition } = await import('@/lib/digital/generate');
    const e = await generateEdition('py', 'loop');
    expect(e.sections[0].pages[0].blocks[1]).toEqual({ type: 'diagram', kind: 'flow', spec: { nodes: [{ text: 'A' }, { text: 'B' }] } });
  });
});
