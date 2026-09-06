import { describe, it, expect } from 'vitest';
import { buildSlideHtml } from '@/lib/renderer/page';
import { renderCover } from '@/lib/renderer/blocks';
import { validatePost } from '@/lib/schema';

const base = {
  brand: 'iolar', template: 'study-sheet', ratio: '3:4', seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] },
};

describe('hero, subtitle and cover', () => {
  it('injects the hero logo into the page chrome and passes the subtitle', () => {
    const post = validatePost({ ...base, slides: [{ page_title: 'IAM', hero: 'iam', subtitle: 'Identity', blocks: [{ type: 'heading', text: 'x' }] }] });
    const html = buildSlideHtml(post, 0);
    expect(html).toContain('id="v-hero"');
    expect(html).toContain('ic-aws');
    expect(html).toContain('class="code-hand has-hero"');
    expect(html).toContain('"subtitle":"Identity"');
  });
  it('renders a cover slide as its own page', () => {
    const post = validatePost({ ...base, slides: [{ page_title: 'c', kind: 'cover', blocks: [], hero: 'aws', cover: { title: 'AWS', subtitle: 'Complete Notes', tagline: 'Beginner → Advanced', icons: [{ icon: 'ec2', label: 'Compute', sub: 'EC2, Lambda' }, { icon: 's3', label: 'Storage' }], pills: ['EC2', 'S3', 'RDS'] } }] });
    const html = buildSlideHtml(post, 0);
    expect(html).toContain('cover-page');
    expect(html).toContain('class="cover-title"');
    expect(html).toContain('cover-logo');
    expect(html).toContain('--cover-cols:2');
    expect(html).toContain('cover-pills');
    expect(html).not.toContain('pk-unit');
    expect(html).toContain('"page_title":"AWS"');
  });
  it('renderCover escapes and marks up its text', () => {
    const h = renderCover({ title: '<AWS>', subtitle: '==all==', icons: [], pills: [] });
    expect(h).toContain('&lt;AWS&gt;');
    expect(h).toContain('<mark class="hl">all</mark>');
  });
});
