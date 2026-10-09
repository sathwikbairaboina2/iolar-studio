import { describe, it, expect } from 'vitest';
import { validateSlide, validatePost, TEMPLATES } from '@/lib/schema';
import { renderBlockHtml, renderSlideBlocks } from '@/lib/renderer/blocks';
import { buildSlideHtml } from '@/lib/renderer/page';
import { SCHEMA_RULES } from '@/lib/ai/rules';
import type { Block } from '@/lib/schema';

const slideWith = (block: unknown) => validateSlide({ page_title: 'P', blocks: [block] });

describe('category blocks: schema', () => {
  it('accepts concept, with and without a tagline', () => {
    expect(slideWith({ type: 'concept', number: 3, title: 'Indexing' }).blocks[0]).toMatchObject({ type: 'concept', number: 3 });
    expect(slideWith({ type: 'concept', number: 3, title: 'Indexing', tagline: 'find fast' }).blocks[0]).toMatchObject({ tagline: 'find fast' });
  });

  it('accepts labelrows of 1-4 rows and rejects 0 or 5', () => {
    const row = { icon: 'database', label: 'What it is:', text: 'A lookup structure' };
    expect(() => slideWith({ type: 'labelrows', rows: [row] })).not.toThrow();
    expect(() => slideWith({ type: 'labelrows', rows: [row, row, row, row] })).not.toThrow();
    expect(() => slideWith({ type: 'labelrows', rows: [] })).toThrow();
    expect(() => slideWith({ type: 'labelrows', rows: [row, row, row, row, row] })).toThrow();
  });

  it('accepts a ribbon heading, a banner callout and a code result', () => {
    expect(slideWith({ type: 'heading', text: 'How it works', style: 'ribbon' }).blocks[0]).toMatchObject({ style: 'ribbon' });
    expect(() => slideWith({ type: 'heading', text: 'x', style: 'wavy' })).toThrow();
    expect(slideWith({ type: 'callout', style: 'banner', title: 'Interview takeaway', text: 't' }).blocks[0]).toMatchObject({ style: 'banner' });
    const c = slideWith({ type: 'code', lang: 'sql', lines: ['SELECT 1;'], result: { headers: ['n'], rows: [['1']] } });
    expect(c.blocks[0]).toMatchObject({ result: { headers: ['n'], rows: [['1']] } });
  });

  it('accepts a slide aside up to 40 characters', () => {
    expect(validateSlide({ page_title: 'P', aside: 'think B-tree!', blocks: [{ type: 'heading', text: 'x' }] }).aside).toBe('think B-tree!');
    expect(() => validateSlide({ page_title: 'P', aside: 'x'.repeat(41), blocks: [{ type: 'heading', text: 'x' }] })).toThrow();
  });

  it('registers the notebook template', () => {
    expect(TEMPLATES).toContain('notebook');
  });

  it('documents every new shape in SCHEMA_RULES', () => {
    for (const s of ['"type":"concept"', '"type":"labelrows"', '"ribbon"', '"banner"', '"result"', '"aside"']) expect(SCHEMA_RULES).toContain(s);
  });
});

describe('category blocks: renderer', () => {
  it('concept draws a zero-padded numeral, the title and the tagline', () => {
    const h = renderBlockHtml({ type: 'concept', number: 3, title: 'Indexing', tagline: 'find fast' } as Block);
    expect(h).toContain('b-concept');
    expect(h).toMatch(/class="cn-num"[^>]*>03</);
    expect(h).toContain('cn-title');
    expect(h).toContain('Indexing');
    expect(h).toContain('cn-tagline');
    expect(renderBlockHtml({ type: 'concept', number: 12, title: 'X' } as Block)).not.toContain('cn-tagline');
    expect(renderBlockHtml({ type: 'concept', number: 12, title: 'X' } as Block)).toContain('>12<');
  });

  it('labelrows draws an icon ring, a label and the text per row', () => {
    const h = renderBlockHtml({ type: 'labelrows', rows: [{ icon: 'database', label: 'What it is:', text: 'A lookup' }, { icon: 'zap', label: 'Why it exists:', text: 'Speed' }] } as Block);
    expect(h).toContain('b-labelrows');
    expect((h.match(/class="lr-row"/g) ?? []).length).toBe(2);
    expect((h.match(/class="lr-icon"/g) ?? []).length).toBe(2);
    expect(h).toContain('<svg');
    expect(h).toContain('lr-label');
    expect(h).toContain('What it is:');
    expect(h).toContain('A lookup');
  });

  it('a ribbon heading carries the ribbon class; a plain heading does not', () => {
    expect(renderBlockHtml({ type: 'heading', text: 'How it works', style: 'ribbon' } as Block)).toContain('hd-ribbon');
    expect(renderBlockHtml({ type: 'heading', text: 'How it works' } as Block)).not.toContain('hd-ribbon');
  });

  it('a banner callout has a bulb icon and a highlighted title', () => {
    const h = renderBlockHtml({ type: 'callout', style: 'banner', title: 'Interview takeaway', text: 'Index reads, pay on writes' } as Block);
    expect(h).toContain('co-banner');
    expect(h).toContain('co-bulb');
    expect(h).toContain('<svg');
    expect(h).toContain('co-title');
    expect(h).toContain('Index reads');
  });

  it('qa turns a leading Q<n>. into a badge and drops the Ans label', () => {
    const h = renderBlockHtml({ type: 'qa', q: 'Q5. What is a primary key?', a_bullets: ['A unique row id'] } as Block);
    expect(h).toMatch(/class="qa-badge"[^>]*>Q5</);
    expect(h).toContain('What is a primary key?');
    expect(h).not.toContain('Q5. What');
    expect(h).not.toContain('qa-ans-label');
    expect(h).not.toContain('Ans→');
    expect(h).toContain('A unique row id');
  });

  it('qa without a number has no badge', () => {
    const h = renderBlockHtml({ type: 'qa', q: 'What is a primary key?', a_bullets: ['x'] } as Block);
    expect(h).not.toContain('qa-badge');
    expect(h).not.toContain('qa-ans-label');
  });

  it('code with a result puts a result table beside the code box', () => {
    const h = renderBlockHtml({ type: 'code', lang: 'sql', lines: ['SELECT n FROM t;'], result: { headers: ['n'], rows: [['1'], ['2']] } } as Block);
    expect(h).toContain('code-with-result');
    expect(h.indexOf('class="b-code')).toBeGreaterThan(-1);
    expect(h.indexOf('code-result')).toBeGreaterThan(h.indexOf('class="b-code'));
    expect(h).toContain('<th');
    expect(h).toContain('>2<');
  });

  it('code without a result is unchanged', () => {
    const h = renderBlockHtml({ type: 'code', lang: 'sql', lines: ['SELECT 1;'] } as Block);
    expect(h).not.toContain('code-with-result');
  });

  it('wraps the new blocks as packing units', () => {
    const html = renderSlideBlocks([{ type: 'concept', number: 1, title: 'X' }, { type: 'labelrows', rows: [{ icon: 'zap', label: 'A:', text: 'b' }] }] as Block[]);
    expect(html).toContain('data-block-type="concept"');
    expect(html).toContain('data-block-type="labelrows"');
  });
});

describe('chrome data (page.ts)', () => {
  const post = (title: string, extra = {}) => validatePost({
    brand: 'b', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: [{ page_title: title, blocks: [{ type: 'heading', text: 'x' }], ...extra }],
  });

  it('passes the aside through PAGE', () => {
    expect(buildSlideHtml(post('T', { aside: 'nice one' }), 0)).toContain('"aside":"nice one"');
    expect(buildSlideHtml(post('T'), 0)).toContain('"aside":""');
  });

  it('strips a leading number from the displayed title', () => {
    for (const t of ['2. Indexing', '12) Indexing', ' 3.  Indexing']) {
      expect(buildSlideHtml(post(t), 0)).toContain('"page_title":"Indexing"');
    }
    expect(buildSlideHtml(post('Page 4: Indexing'), 0)).toContain('"page_title":"Indexing"');
    expect(buildSlideHtml(post('2025 Trends'), 0)).toContain('"page_title":"2025 Trends"');
  });
});

describe('page width of the new blocks', () => {
  it('an opener, its label rows and a banner are page-wide; other callouts and a plain code box are not', async () => {
    const { forcesFullWidth } = await import('@/lib/renderer/blocks');
    expect(forcesFullWidth({ type: 'concept', number: 1, title: 'X' } as Block)).toBe(true);
    expect(forcesFullWidth({ type: 'labelrows', rows: [{ icon: 'zap', label: 'A:', text: 'b' }] } as Block)).toBe(true);
    expect(forcesFullWidth({ type: 'callout', style: 'banner', title: 't', text: 'x' } as Block)).toBe(true);
    expect(forcesFullWidth({ type: 'callout', style: 'tip', title: 't', text: 'x' } as Block)).toBe(false);
    expect(forcesFullWidth({ type: 'code', lang: 'sql', lines: ['SELECT 1;'], result: { headers: ['n'], rows: [['1']] } } as Block)).toBe(false);
  });
});

describe('page count in the page chrome', () => {
  const two = () => validatePost({
    brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: [{ page_title: 'One', blocks: [{ type: 'paragraph', text: 'a' }] }, { page_title: 'Two', blocks: [{ type: 'paragraph', text: 'b' }] }],
    caption: { text: '', hashtags: [] },
  });

  it('defaults to the slides in the post and takes the part\'s real page count when given one', () => {
    expect(buildSlideHtml(two(), 1)).toContain('"pageCount":2');
    expect(buildSlideHtml(two(), 1, { pageCount: 19 })).toContain('"pageCount":19');
  });
});
