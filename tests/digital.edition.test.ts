import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };

const edition = () => ({
  schema: 1 as const,
  subject: 'py',
  chapter: 'loop',
  inputsHash: 'h',
  generatedAt: '2026-10-09T00:00:00.000Z',
  sections: [
    { title: 'Introduction', role: 'intro' as const, pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text: 'Hello' }] }] },
    {
      title: 'Coroutines', role: 'outline' as const, outlineIndex: 0,
      pages: [{
        title: 'Run one',
        blocks: [
          { type: 'paragraph', text: 'A **coroutine**.' },
          { type: 'code', lang: 'python', lines: ['print(1)'] },
          { type: 'code', lang: 'output', lines: ['1'] },
          { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] },
          { type: 'diagram', kind: 'flowchart', spec: { rows: [['a'], ['b']], nodes: { a: { text: 'A' }, b: { text: 'B' } }, edges: [{ from: 'a', to: 'b' }] } },
        ],
      }],
    },
    { title: 'Check yourself', role: 'quiz' as const, pages: [{ title: 'Quiz', blocks: [{ type: 'qa', q: 'Q?', a_bullets: ['A'] }] }] },
  ],
});

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(path.join(tmpdir(), 'dig-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'd' });
  put('handbooks/py/loop/chapter.json', { title: 'Loop', order: 0 });
  put('handbooks/py/loop/book.json', { title: 'Loop', summary: 's', chapters: [{ title: 'a', points: ['p'] }] });
  put('handbooks/py/loop/parts/01/post.json', { brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'P', blocks: [{ type: 'paragraph', text: 'x' }] }] });
});

describe('edition', () => {
  it('round-trips through save and load', async () => {
    const { saveEdition, loadEdition } = await import('@/lib/digital/edition');
    await saveEdition(edition());
    expect(await loadEdition('py', 'loop')).toEqual(edition());
    expect(existsSync(path.join(root, 'handbooks/py/loop/digital/edition.json'))).toBe(true);
  });

  it('numbers parts 1..n and maps pages', async () => {
    const { asChapterParts } = await import('@/lib/digital/edition');
    const parts = asChapterParts(edition());
    expect(parts.map((p) => p.n)).toEqual([1, 2, 3]);
    expect(parts[1]).toMatchObject({ title: 'Coroutines' });
    expect(parts[1].pages[0].title).toBe('Run one');
  });

  it('accepts a valid edition and rejects a page with no blocks', async () => {
    const { validateEdition } = await import('@/lib/digital/edition');
    expect(validateEdition(edition(), 'Loop')).toEqual({ ok: true });
    const bad = edition();
    bad.sections[0].pages[0].blocks = [];
    const r = validateEdition(bad, 'Loop');
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid block and writes nothing', async () => {
    const { saveEdition } = await import('@/lib/digital/edition');
    const bad = edition();
    bad.sections[1].pages[0].blocks = [{ type: 'table', headers: [], rows: [] }];
    await expect(saveEdition(bad)).rejects.toThrow();
    expect(existsSync(path.join(root, 'handbooks/py/loop/digital'))).toBe(false);
  });

  it('inputsHash changes when book.json changes, and editionHash with the sections', async () => {
    const { inputsHash, editionHash } = await import('@/lib/digital/edition');
    const a = await inputsHash('py', 'loop');
    put('handbooks/py/loop/book.json', { title: 'Loop', summary: 's', chapters: [{ title: 'a', points: ['p', 'q'] }] });
    expect(await inputsHash('py', 'loop')).not.toBe(a);
    const e = edition();
    const h = editionHash(e);
    e.sections[0].title = 'Other';
    expect(editionHash(e)).not.toBe(h);
  });

  it('rejects an edition over the page, code block and size caps', async () => {
    const { validateEdition, MAX_PAGES_PER_SECTION, MAX_CODE_BLOCKS_PER_SECTION, MAX_CODE_BLOCKS_PER_EDITION, MAX_EDITION_BYTES } = await import('@/lib/digital/edition');
    expect([MAX_PAGES_PER_SECTION, MAX_CODE_BLOCKS_PER_SECTION, MAX_CODE_BLOCKS_PER_EDITION, MAX_EDITION_BYTES]).toEqual([6, 12, 160, 1_500_000]);
    const para = { type: 'paragraph', text: 'x' };
    const code = { type: 'code', lang: 'python', lines: ['print(1)'] };
    const out = { type: 'code', lang: 'output', lines: ['1'] };
    const withSection = (pages: { title: string; blocks: unknown[] }[]) => {
      const e = edition() as unknown as { sections: { pages: unknown[] }[] };
      e.sections[1].pages = pages;
      return e as unknown as ReturnType<typeof edition>;
    };
    const page = (blocks: unknown[]) => ({ title: 'p', blocks });
    expect(validateEdition(withSection(Array.from({ length: 6 }, () => page([para]))), 'Loop').ok).toBe(true);
    const tooMany = validateEdition(withSection(Array.from({ length: 7 }, () => page([para]))), 'Loop');
    expect(tooMany.ok === false && tooMany.errors.join(' ')).toMatch(/7 pages.*6/);
    // an output block is shown beside its example and does not count as one
    expect(validateEdition(withSection([page(Array.from({ length: 12 }, () => code).concat(out))]), 'Loop').ok).toBe(true);
    const tooMuchCode = validateEdition(withSection([page(Array.from({ length: 13 }, () => code))]), 'Loop');
    expect(tooMuchCode.ok === false && tooMuchCode.errors.join(' ')).toMatch(/13 code blocks.*12/);
    const big = edition();
    big.sections[0].pages[0].blocks = [{ type: 'paragraph', text: 'y'.repeat(1_500_001) }];
    const tooBig = validateEdition(big, 'Loop');
    expect(tooBig.ok === false && tooBig.errors.join(' ')).toMatch(/1500000/);
    const many = edition();
    many.sections = [many.sections[0], ...Array.from({ length: 14 }, (_, i) => ({ title: `S${i}`, role: 'outline' as const, outlineIndex: i, pages: [{ title: 'p', blocks: Array.from({ length: 12 }, () => code) }] })), many.sections[2]];
    const tooManyCode = validateEdition(many, 'Loop');
    expect(tooManyCode.ok === false && tooManyCode.errors.join(' ')).toMatch(/168 code blocks.*160/);
  });
});
