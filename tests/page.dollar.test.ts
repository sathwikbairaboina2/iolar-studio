import { describe, it, expect } from 'vitest';
import { buildSlideHtml } from '@/lib/renderer/page';
import type { Post } from '@/lib/schema';

// Shell and awk chapters put `$$`, `$&`, `` $` `` and `$1` inside cells. Those are
// replacement patterns to String.replace, so slotting content into the template
// with a plain string used to eat them — or paste the whole page prefix into a cell.
const post = (): Post =>
  ({
    brand: 'iolar',
    template: 'spiral-notes',
    ratio: '3:4',
    seed: 42,
    series: 'S',
    date: '07/09/2026',
    slides: [
      {
        page_title: 'Interpolation $& Defaults',
        blocks: [
          {
            type: 'table',
            headers: ['Form', 'Fires when'],
            rows: [
              ['`${VAR:-def}`', 'unset or empty'],
              ['`$$`', 'literal `$`'],
              ['awk `$1`', 'first field'],
              ["sed `$'`", 'whole match'],
            ],
          },
        ],
      },
    ],
  }) as unknown as Post;

describe('buildSlideHtml with $ sequences in content', () => {
  const html = buildSlideHtml(post(), 0);

  it('leaves no substitution markers behind', () => {
    expect(html).not.toContain('<!--CONTENT-->');
    expect(html).not.toContain('<!--HEAD-->');
    expect(html).not.toContain('<!--PAGEVARS-->');
  });

  it('keeps `$$` as two dollars, not one', () => {
    expect(html).toContain('<code class="mono">$$</code>');
  });

  it('keeps `$&` and `` $` `` cells intact instead of splicing the page into them', () => {
    expect(html).toContain('sed <code class="mono">$&#39;</code>');
    expect(html).toContain('literal <code class="mono">$</code>');
    // $` would paste everything before the match; the page has exactly one doctype.
    expect((html.match(/<!DOCTYPE/gi) ?? []).length).toBe(1);
  });

  it('keeps a $ sequence in the page title out of the page vars script', () => {
    expect(html).toContain('Interpolation $& Defaults');
  });
});
