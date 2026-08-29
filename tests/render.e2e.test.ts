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
    const totalBlocks = slides.reduce((n, s) => n + s.blocks.length, 0);
    expect(totalBlocks).toBe(40);
  }, 240_000);

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
