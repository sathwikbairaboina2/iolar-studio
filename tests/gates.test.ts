import { describe, it, expect } from 'vitest';
import { checkCodeBlock, checkTables, checkHeadings, checkStrandedHeadings } from '@/lib/verify/gates';
import type { Block, Slide } from '@/lib/schema';

const code = (lines: string[], runnable?: boolean): Block =>
  ({ type: 'code', lang: 'python', lines, ...(runnable === undefined ? {} : { runnable }) } as Block);

describe('checkCodeBlock', () => {
  it('accepts a complete program', () => {
    expect(checkCodeBlock(code(['xs = [1, 2]', 'xs.append(3)', 'print(xs)'], true))).toEqual([]);
  });

  it('accepts an illustrative fragment that does not compile', () => {
    expect(checkCodeBlock(code(['@repeat(3)', 'def f(): ...']))).toEqual([]);
  });

  it('flags a severed body — the block starts indented', () => {
    const found = checkCodeBlock(code(['    def __next__(s):', '        return 1']));
    expect(found.map((f) => f.rule)).toContain('code.severed');
  });

  it('flags a def with no body', () => {
    const found = checkCodeBlock(code(['def deco(fn) -> None:', '', 'x = 1']));
    expect(found.map((f) => f.rule)).toContain('code.empty-body');
  });

  it('flags an orphaned except', () => {
    const found = checkCodeBlock(code(['except ValueError as e:', "    raise RuntimeError('x') from e"]));
    expect(found.map((f) => f.rule)).toContain('code.orphan-clause');
  });

  it('flags the same name defined twice at top level', () => {
    const found = checkCodeBlock(code([
      'def repeat(n):', '    return n',
      'def repeat(n):', '    return n + 1',
    ]));
    expect(found.map((f) => f.rule)).toContain('code.redefined');
  });

  it('leaves non-python languages to parse-only', () => {
    const sql = { type: 'code', lang: 'sql', lines: ['SELECT 1'] } as Block;
    expect(checkCodeBlock(sql)).toEqual([]);
  });
});

describe('checkTables', () => {
  it('flags a row narrower than its headers', () => {
    const b = { type: 'table', headers: ['a', 'b', 'c'], rows: [['1', '2']] } as Block;
    expect(checkTables(b).map((f) => f.rule)).toContain('table.shape');
  });

  it('accepts a well-formed table', () => {
    const b = { type: 'table', headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] } as Block;
    expect(checkTables(b)).toEqual([]);
  });
});

describe('checkHeadings', () => {
  it('flags a heading repeated within the part', () => {
    const slides = [
      { page_title: 'p1', blocks: [{ type: 'heading', text: '1. Time Complexity' }] },
      { page_title: 'p2', blocks: [{ type: 'heading', text: '4. Time complexity' }] },
    ] as Slide[];
    const found = checkHeadings(slides);
    expect(found.map((f) => f.rule)).toContain('heading.unique');
    expect(found[0].page).toBe(2);
  });

  it('accepts distinct headings', () => {
    const slides = [
      { page_title: 'p1', blocks: [{ type: 'heading', text: '1. Lists' }] },
      { page_title: 'p2', blocks: [{ type: 'heading', text: '2. Tuples' }] },
    ] as Slide[];
    expect(checkHeadings(slides)).toEqual([]);
  });

  it('keeps a repeat inside one section major', () => {
    const slides = [
      { page_title: 'AWS IAM', blocks: [{ type: 'heading', text: '1. Best Practices' }] },
      { page_title: 'AWS IAM (cont.)', blocks: [{ type: 'heading', text: '4. Best Practices' }] },
    ] as Slide[];
    const found = checkHeadings(slides).filter((f) => f.rule === 'heading.unique');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('major');
  });

  it('downgrades a repeat across different sections to minor', () => {
    const slides = [
      { page_title: 'AWS IAM', blocks: [{ type: 'heading', text: '8. Best Practices' }] },
      { page_title: 'VPC Networking', blocks: [{ type: 'heading', text: '8. Best Practices' }] },
    ] as Slide[];
    const found = checkHeadings(slides).filter((f) => f.rule === 'heading.unique');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('minor');
  });
});

describe('checkStrandedHeadings', () => {
  it('flags a page that ends on a heading while another page follows', () => {
    const slides = [
      { page_title: 'p1', blocks: [{ type: 'bullets', items: ['a'] }, { type: 'heading', text: 'Symptom → Cause' }] },
      { page_title: 'p2', blocks: [{ type: 'table', headers: ['S', 'C'], rows: [['x', 'y']] }, { type: 'heading', text: 'Last word' }] },
    ] as Slide[];
    const found = checkStrandedHeadings(slides);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'heading.stranded', severity: 'major', page: 1, block: 1 });
  });

  it('accepts headings followed by their section', () => {
    const slides = [
      { page_title: 'p1', blocks: [{ type: 'heading', text: 'A' }, { type: 'bullets', items: ['a'] }] },
      { page_title: 'p2', blocks: [{ type: 'heading', text: 'B' }, { type: 'bullets', items: ['b'] }] },
    ] as Slide[];
    expect(checkStrandedHeadings(slides)).toEqual([]);
  });
});
