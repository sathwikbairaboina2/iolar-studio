import { describe, it, expect, afterAll } from 'vitest';
import { renderSlide, closeBrowser } from '@/lib/renderer/capture';
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

  it('reports overflow for absurd content, never shrinks', async () => {
    const big = makePost('spiral-notes');
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({
      type: 'paragraph' as const,
      text: 'Long line of handwritten content that keeps going. '.repeat(4),
    }));
    const out = path.join(tmpdir(), `iolar-ovf-${Date.now()}.png`);
    const r = await renderSlide(big, 0, out);
    expect(r.overflowPx).toBeGreaterThan(0);
  }, 90_000);

  it('is deterministic: same seed => identical bytes', async () => {
    const a = path.join(tmpdir(), `iolar-a-${Date.now()}.png`);
    const b = path.join(tmpdir(), `iolar-b-${Date.now()}.png`);
    await renderSlide(makePost('spiral-notes'), 0, a);
    await renderSlide(makePost('spiral-notes'), 0, b);
    const [ba, bb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
    expect(Buffer.compare(ba, bb)).toBe(0);
  }, 120_000);
});
