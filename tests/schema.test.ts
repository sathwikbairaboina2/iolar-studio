import { describe, it, expect } from 'vitest';
import { validatePost, MAX_SLIDES } from '@/lib/schema';

const minimal = {
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 42,
  series: 'TEST SERIES', date: '29/08/2026',
  slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'Hi' }] }],
  caption: { text: 'c', hashtags: ['#x'] },
};

describe('PostSchema', () => {
  it('strips section numbers the author typed into a heading', () => {
    const post = validatePost({
      ...minimal,
      slides: [{ page_title: 'P', blocks: [
        { type: 'heading', text: '12. Retention' },
        { type: 'heading', text: '3) Compaction' },
        { type: 'heading', text: 'Tombstones' },
        { type: 'heading', text: '404' },
      ] }],
    });
    const texts = post.slides[0].blocks.map((b) => (b as { text: string }).text);
    // A heading that is nothing but a number keeps it — stripping would leave an empty label.
    expect(texts).toEqual(['Retention', 'Compaction', 'Tombstones', '404']);
  });

  it('accepts a minimal valid post', () => {
    expect(validatePost(minimal).slides.length).toBe(1);
  });
  it('rejects unknown block type', () => {
    const bad = structuredClone(minimal);
    (bad.slides[0].blocks[0] as { type: string }).type = 'nope';
    expect(() => validatePost(bad)).toThrow();
  });
  it('accepts more than MAX_SLIDES slides (the cap is advisory)', () => {
    const many = structuredClone(minimal);
    many.slides = Array.from({ length: MAX_SLIDES + 2 }, (_, i) => ({
      page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
    }));
    expect(validatePost(many).slides.length).toBe(MAX_SLIDES + 2);
  });
  it('rejects bad ratio', () => {
    expect(() => validatePost({ ...minimal, ratio: '9:16' })).toThrow();
  });
});
