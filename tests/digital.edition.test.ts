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

  it('rejects an edition over the page count, edition code and size caps', async () => {
    const { validateEdition, MAX_PAGES_PER_SECTION, MAX_CODE_BLOCKS_PER_SECTION, MAX_CODE_BLOCKS_PER_EDITION, MAX_EDITION_BYTES } = await import('@/lib/digital/edition');
    expect([MAX_PAGES_PER_SECTION, MAX_CODE_BLOCKS_PER_SECTION, MAX_CODE_BLOCKS_PER_EDITION, MAX_EDITION_BYTES]).toEqual([6, 12, 160, 1_500_000]);
    const para = { type: 'paragraph', text: 'x' };
    const code = { type: 'code', lang: 'python', lines: ['print(1)'] };
    const withIntro = (pages: { title: string; blocks: unknown[] }[]) => {
      const e = edition() as unknown as { sections: { pages: unknown[] }[] };
      e.sections[0].pages = pages;
      return e as unknown as ReturnType<typeof edition>;
    };
    const page = (blocks: unknown[]) => ({ title: 'p', blocks });
    expect(validateEdition(withIntro(Array.from({ length: 6 }, () => page([para]))), 'Loop').ok).toBe(true);
    const tooMany = validateEdition(withIntro(Array.from({ length: 7 }, () => page([para]))), 'Loop');
    expect(tooMany.ok === false && tooMany.errors.join(' ')).toMatch(/7 pages.*6/);
    const big = edition();
    big.sections[0].pages[0].blocks = [{ type: 'paragraph', text: 'y'.repeat(1_500_001) }];
    const tooBig = validateEdition(big, 'Loop');
    expect(tooBig.ok === false && tooBig.errors.join(' ')).toMatch(/1500000/);
    const many = edition();
    many.sections = [...Array.from({ length: 81 }, (_, i) => ({ title: `S${i}`, role: 'intro' as const, pages: [page([code, code])] })), many.sections[2]] as never;
    const tooManyCode = validateEdition(many, 'Loop');
    expect(tooManyCode.ok === false && tooManyCode.errors.join(' ')).toMatch(/162 code blocks.*160/);
  });

  describe('revision page caps', () => {
    const para = (text = 'A short note.') => ({ type: 'paragraph', text });
    const code = (n = 1) => ({ type: 'code', lang: 'python', lines: Array.from({ length: n }, (_, i) => `print(${i})`) });
    const out = { type: 'code', lang: 'output', lines: ['1'] };
    const table = { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] };
    const bullets = (...items: string[]) => ({ type: 'bullets', items });
    const heading = { type: 'heading', text: 'A heading' };
    const onePage = async (blocks: unknown[]) => {
      const { validateEdition } = await import('@/lib/digital/edition');
      const e = edition();
      e.sections[1].pages = [{ title: 'Run one', blocks }] as never;
      return validateEdition(e, 'Loop');
    };
    const message = (r: { ok: boolean } & { errors?: string[] }) => (r.ok ? '' : (r.errors ?? []).join(' '));

    it('exports the caps', async () => {
      const m = await import('@/lib/digital/edition');
      expect([m.MAX_BLOCKS_PER_PAGE, m.MAX_CODE_BLOCKS_PER_PAGE, m.MAX_TABLES_PER_PAGE, m.MAX_CODE_LINES, m.MAX_PARAGRAPHS_PER_PAGE, m.MAX_PARAGRAPH_CHARS, m.MAX_BULLET_CHARS]).toEqual([14, 2, 2, 8, 1, 160, 120]);
    });

    it('accepts a compact page and does not count output blocks as code', async () => {
      const blocks = [heading, bullets('one', 'two'), code(8), out, code(2), out, table, table, para(), { type: 'callout', style: 'sticky', title: 't', text: 'x' }];
      expect(await onePage(blocks)).toEqual({ ok: true });
    });

    it('rejects an outline section with two pages', async () => {
      const { validateEdition } = await import('@/lib/digital/edition');
      const e = edition();
      e.sections[1].pages = [{ title: 'a', blocks: [para()] }, { title: 'b', blocks: [para()] }] as never;
      const r = validateEdition(e, 'Loop');
      expect(message(r)).toMatch(/section "Coroutines" has 2 pages; an outline section has exactly 1/);
    });

    it('rejects 15 blocks', async () => {
      const r = await onePage(Array.from({ length: 15 }, () => bullets('x')));
      expect(message(r)).toMatch(/15 blocks; the most allowed is 14/);
    });

    it('rejects 3 code blocks', async () => {
      expect(message(await onePage([code(), code(), code()]))).toMatch(/3 code blocks; the most allowed is 2/);
    });

    it('rejects 3 tables', async () => {
      expect(message(await onePage([table, table, table]))).toMatch(/3 tables; the most allowed is 2/);
    });

    it('rejects a 9-line code block', async () => {
      expect(message(await onePage([code(9)]))).toMatch(/code block of 9 lines; the most allowed is 8/);
    });

    it('rejects two paragraphs', async () => {
      expect(message(await onePage([para(), para()]))).toMatch(/2 paragraphs; the most allowed is 1/);
    });

    it('rejects a 200-character paragraph', async () => {
      expect(message(await onePage([para('p'.repeat(200))]))).toMatch(/paragraph of 200 characters; the most allowed is 160/);
    });

    it('rejects a 150-character bullet', async () => {
      expect(message(await onePage([bullets('ok', 'b'.repeat(150))]))).toMatch(/bullet of 150 characters; the most allowed is 120/);
    });

    it('measures the text a reader sees, not the inline markers', async () => {
      const marked = '==' + 'w'.repeat(105) + '== and **bold**';
      expect(await onePage([bullets(marked)])).toEqual({ ok: true });
    });
  });
});

describe('caps per category', () => {
  const drillPage = (tasks: number, extraCode = 0) => ({
    title: 'Drills',
    blocks: [
      ...Array.from({ length: tasks }, (_, i) => [
        { type: 'heading', text: `Q${i + 1}. Task` },
        { type: 'code', lang: 'python', lines: ['print(1)'] },
        { type: 'code', lang: 'output', lines: ['1'] },
      ]).flat(),
      ...Array.from({ length: extraCode }, () => ({ type: 'code', lang: 'python', lines: ['x'] })),
    ],
  });
  const withPage = (page: unknown, category?: string) => {
    const e = edition();
    e.sections[1].pages = [page as never];
    return { ...e, ...(category ? { category } : {}) } as never;
  };

  it('lets a drills page hold 6 tasks, and nothing else', async () => {
    const { validateEdition } = await import('@/lib/digital/edition');
    expect(validateEdition(withPage(drillPage(6), 'drills'), 'Loop')).toEqual({ ok: true });
    const noCategory = validateEdition(withPage(drillPage(6)), 'Loop');
    expect(noCategory.ok).toBe(false);
    expect(validateEdition(withPage(drillPage(6), 'handbook'), 'Loop').ok).toBe(false);
    expect(validateEdition(withPage(drillPage(6, 1), 'drills'), 'Loop').ok).toBe(false);
    expect(validateEdition(withPage(drillPage(7), 'drills'), 'Loop').ok).toBe(false);
  });

  it('capsFor gives drills 18 blocks and 6 code blocks, everything else the defaults', async () => {
    const { capsFor, DEFAULT_CAPS } = await import('@/lib/digital/edition');
    expect(capsFor('drills')).toEqual({ blocks: 18, code: 6, tables: 2, codeLines: 8 });
    expect(capsFor('listicle')).toEqual(DEFAULT_CAPS);
    expect(capsFor()).toEqual({ blocks: 14, code: 2, tables: 2, codeLines: 8 });
  });

  it('capsFor gives a quick-revision handbook page 10 blocks and 170 words', async () => {
    const { capsFor } = await import('@/lib/digital/edition');
    expect(capsFor('handbook')).toEqual({ blocks: 10, code: 2, tables: 2, codeLines: 8, words: 170 });
  });

  const wordy = (n: number) => ({
    title: 'Wordy',
    blocks: [{ type: 'bullets', style: 'dot', ink: 'blue', items: [...Array.from({ length: Math.floor(n / 5) }, (_, i) => `==a${i}== b c d e`), ...(n % 5 ? [Array.from({ length: n % 5 }, () => 'z').join(' ')] : [])] }],
  });

  it('a handbook page over 170 words fails with the count, the cap and the instruction; the same page in listicle passes', async () => {
    const { pageCapErrors, capsFor } = await import('@/lib/digital/edition');
    const errors = pageCapErrors(wordy(171) as never, capsFor('handbook'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('page "Wordy"');
    expect(errors[0]).toContain('171 words');
    expect(errors[0]).toContain('170');
    expect(errors[0]).toContain('cut it to the must-know lines');
    expect(pageCapErrors(wordy(170) as never, capsFor('handbook'))).toEqual([]);
    expect(pageCapErrors(wordy(171) as never, capsFor('listicle'))).toEqual([]);
  });

  it('counts visible words only: markup stripped, type/kind/style/ink/icon/frame/lang skipped', async () => {
    const { pageCapErrors } = await import('@/lib/digital/edition');
    const page = { title: 'T', blocks: [{ type: 'callout', style: 'sticky', ink: 'red', icon: 'bulb', frame: 'solid', text: '**two** {blue:three words} ==x==' }] };
    expect(pageCapErrors(page as never, { blocks: 10, code: 2, tables: 2, codeLines: 8, words: 4 })).toEqual([]);
    expect(pageCapErrors(page as never, { blocks: 10, code: 2, tables: 2, codeLines: 8, words: 3 })).toHaveLength(1);
  });

  it('validateEdition leaves existing editions alone unless asked for the fresh caps', async () => {
    const { validateEdition } = await import('@/lib/digital/edition');
    const e = edition();
    e.sections[1].pages = [wordy(300) as never];
    const old = { ...e, category: 'handbook' } as never;
    expect(validateEdition(old, 'Loop')).toEqual({ ok: true });
    const fresh = validateEdition(old, 'Loop', { fresh: true });
    expect(fresh.ok).toBe(false);
    expect(validateEdition({ ...e, category: 'listicle' } as never, 'Loop', { fresh: true })).toEqual({ ok: true });
  });
});
