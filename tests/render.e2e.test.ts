import { describe, it, expect, afterAll } from 'vitest';
import { renderSlide, renderAll, closeBrowser } from '@/lib/renderer/capture';
import { validatePost, Post } from '@/lib/schema';
import path from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import sharp from 'sharp';

function makePost(template: string): Post {
  return validatePost({
    brand: 'iolar', template, ratio: '3:4', seed: 7,
    series: 'RENDER TEST', date: '29/08/2026',
    slides: [{
      page_title: 'SMOKE', blocks: [
        { type: 'heading', text: '1. Hello render' },
        { type: 'bullets', items: ['one', 'two'] },
        { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
        { type: 'qa', q: 'What is Python?', a_bullets: ['high-level', 'interpreted'], example_code: ['x = 10  # int'] },
      ],
    }],
    caption: { text: '', hashtags: [] },
  });
}

afterAll(async () => { await closeBrowser(); });

describe('renderSlide', () => {
  it.each(['spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel', 'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall'])('%s produces a 1080x1440 png with no overflow', async (template) => {
    const out = path.join(tmpdir(), `iolar-test-${template}-${Date.now()}.png`);
    const r = await renderSlide(makePost(template), 0, out);
    expect(existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1440]);
    expect(r.overflowPx).toBe(0);
  }, 90_000);

  it('spills overflowing content instead of overflowing the page', async () => {
    const big = makePost('spiral-notes');
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({
      type: 'paragraph' as const,
      text: 'Long line of handwritten content that keeps going. '.repeat(4),
    }));
    const out = path.join(tmpdir(), `iolar-ovf-${Date.now()}.png`);
    const r = await renderSlide(big, 0, out);
    expect(r.overflowPx).toBe(0);
    expect(r.spillIndexes.length).toBeGreaterThan(0);
  }, 90_000);

  it('renderAll chains spill onto new slides', async () => {
    const big = makePost('spiral-notes');
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({
      type: 'paragraph' as const,
      text: 'Long line of handwritten content that keeps going. '.repeat(4),
    }));
    const dir = path.join(tmpdir(), `iolar-flow-${Date.now()}`);
    const { results, slides } = await renderAll(big, dir);
    expect(slides.length).toBeGreaterThan(1);
    expect(results.length).toBe(slides.length);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
    expect(slides[1].page_title).toContain('(cont.)');
    expect(slides[1].cont).toBe(true);
    const totalBlocks = slides.reduce((n, s) => n + s.blocks.length, 0);
    expect(totalBlocks).toBe(40);

    // Content is never trimmed or spread thin: every page but the last is filled to capacity.
    const fills = results.map((r) => r.fillPct);
    for (const f of fills.slice(0, -1)) expect(f).toBeGreaterThan(85);

    // Idempotent: re-rendering the split result must not split it again.
    const again = await renderAll({ ...big, slides }, dir);
    expect(again.slides.length).toBe(slides.length);
  }, 480_000);

  it.each(['spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel', 'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall'])(
    '%s fills a dense page without overflowing',
    async (template) => {
      const dense = makePost(template);
      dense.slides[0].blocks = [
        { type: 'heading', text: '1. Overview' },
        { type: 'paragraph', text: 'A dense page exercising the packer with mixed block widths and heights.' },
        { type: 'bullets', items: ['first point', 'second point', 'third point', 'fourth point'] },
        { type: 'heading', text: '2. Comparison' },
        { type: 'table', headers: ['Type', 'Ordered', 'Mutable', 'Use'], rows: [['list', 'yes', 'yes', 'sequence'], ['tuple', 'yes', 'no', 'fixed'], ['set', 'no', 'yes', 'unique']] },
        { type: 'heading', text: '3. Example' },
        { type: 'code', lang: 'python', lines: ['xs = [1, 2, 3]', 'xs.append(4)', 'print(xs)'] },
        { type: 'sidebox', title: 'Remember', items: ['sets drop duplicates', 'tuples hash'], ink: 'green' },
        { type: 'callout', style: 'tip', title: 'Interview Tip', text: 'Name the complexity before you pick the container.' },
      ];
      const out = path.join(tmpdir(), `iolar-dense-${template}-${Date.now()}.png`);
      const r = await renderSlide(dense, 0, out);
      expect(r.overflowPx).toBe(0);
      expect(r.spillIndexes).toEqual([]);
    },
    120_000
  );

  it('is deterministic: same seed => identical bytes', async () => {
    const a = path.join(tmpdir(), `iolar-a-${Date.now()}.png`);
    const b = path.join(tmpdir(), `iolar-b-${Date.now()}.png`);
    await renderSlide(makePost('spiral-notes'), 0, a);
    await renderSlide(makePost('spiral-notes'), 0, b);
    const [ba, bb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
    expect(Buffer.compare(ba, bb)).toBe(0);
  }, 120_000);
});

describe('balanceTail', () => {
  it('lifts a starved final page without starving the one before it', async () => {
    // Enough blocks to need two pages, with the remainder small: greedy pagination alone
    // would leave the tail nearly empty.
    const post = makePost('spiral-notes');
    post.slides[0].blocks = Array.from({ length: 26 }, (_, i) => ({
      type: 'bullets' as const,
      items: [`point ${i} alpha`, `point ${i} beta`, `point ${i} gamma`, `point ${i} delta`],
    }));
    const dir = path.join(tmpdir(), `iolar-tail-${Date.now()}`);
    const { results, slides } = await renderAll(post, dir);

    expect(results.length).toBeGreaterThan(1);
    const last = results[results.length - 1];
    const prev = results[results.length - 2];
    // The tail is not left as a scrap, and the page it borrowed from is still substantial.
    expect(last.fillPct).toBeGreaterThan(20);
    expect(prev.fillPct).toBeGreaterThan(55);
    // Nothing was invented or lost while rebalancing.
    expect(slides.reduce((n, s) => n + s.blocks.length, 0)).toBe(26);
  }, 300_000);

  it('renders a post whose pagination exceeds its authored page count', async () => {
    // Regression: reverting a rejected move indexed the authored post, which is shorter
    // than the paginated result, and threw.
    const post = makePost('spiral-notes');
    post.slides[0].blocks = Array.from({ length: 60 }, (_, i) => ({
      type: 'paragraph' as const,
      text: `Paragraph ${i} with enough words to occupy a fair slice of the column. `.repeat(2),
    }));
    const dir = path.join(tmpdir(), `iolar-overflow-${Date.now()}`);
    const { results, slides } = await renderAll(post, dir);

    expect(slides.length).toBeGreaterThan(post.slides.length);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
    expect(slides.reduce((n, s) => n + s.blocks.length, 0)).toBe(60);
  }, 300_000);
});
