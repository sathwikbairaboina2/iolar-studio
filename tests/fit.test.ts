import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';
import { mergeContinuations } from '@/lib/renderer/capture';

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [
    { page_title: 'Lists', blocks: [{ type: 'heading', text: 'A' }, { type: 'paragraph', text: 'one' }] },
    { page_title: 'Lists (cont.)', cont: true, blocks: [{ type: 'paragraph', text: 'two' }] },
    { page_title: 'Sets', blocks: [{ type: 'heading', text: 'B' }] },
  ],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-fit-'));
  vi.resetModules();
});

describe('mergeContinuations', () => {
  it('merges only pages continuing the same chapter', () => {
    const merged = mergeContinuations(base().slides);
    expect(merged.map((s) => s.page_title)).toEqual(['Lists', 'Sets']);
    expect(merged[0].blocks.length).toBe(3);
  });

  it('leaves a post with no continuation flags untouched', () => {
    const post = base();
    post.slides = post.slides.map((s) => ({ ...s, cont: undefined }));
    expect(mergeContinuations(post.slides).length).toBe(3);
  });
});

describe('fitToPages guard', () => {
  it('rejects a proposal that removes blocks', async () => {
    const shrunk = base();
    shrunk.slides = mergeContinuations(shrunk.slides).map((s) => ({ ...s, blocks: [s.blocks[0]] }));

    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(shrunk)),
      ClaudeUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/renderer/capture', async () => {
      const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
      return { ...actual, renderSlide: vi.fn().mockResolvedValue({ overflowPx: 0, fillPct: 40, spillIndexes: [], neededPct: 40 }) };
    });

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'fit-demo');
    await savePost('python', 'fit-demo', 1, base());
    const { fitToPages } = await import('@/lib/ai/fit');
    await expect(fitToPages('python', 'fit-demo', 1)).rejects.toThrow(/removed content/);
  });
});

describe('uncoveredPoints', () => {
  const book = (points: string[]) => ({
    title: 'T', summary: 'S',
    chapters: [{ title: 'C', points }],
  });

  const pageWith = (...lines: string[]): Post => validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
    series: 'S', date: '29/08/2026',
    slides: [{ page_title: 'Notes', blocks: [{ type: 'bullets', items: lines }] }],
    caption: { text: '', hashtags: [] },
  });

  it('matches code identifiers the page actually teaches', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    // Regression: keywords were stripped of dots and brackets but the page text was not, so
    // every identifier like `arr.push` was unmatchable and its point read as lost.
    const points = [
      'Mutating state directly (`arr.push`, `obj.x = 1`) so `Object.is` sees no change',
      'resolving `api.github.com` (2 dots) fires failing NXDOMAIN lookups first',
    ];
    const page = pageWith(
      'never mutate state directly: arr.push(x) leaves Object.is equal, so nothing changes',
      'api.github.com has 2 dots, so the search list fires NXDOMAIN lookups first',
    );
    expect(uncoveredPoints(book(points), page)).toEqual([]);
  });

  it('counts a word the same however it is inflected', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    const points = ['The kubelet starts evicting pods under node-pressure'];
    expect(uncoveredPoints(book(points), pageWith('node-pressure eviction is done by the kubelet'))).toEqual([]);
  });

  it('still reports a point the pages never teach', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    const points = [
      'Readiness flapping causes endpoint churn that reaches kube-proxy on every change',
      'CPU is compressible, so shares already provide fairness without limits',
    ];
    const page = pageWith('a pod groups containers', 'deployments roll out replicas gradually');
    expect(uncoveredPoints(book(points), page)).toHaveLength(2);
  });

  it('is not satisfied by the common words a point shares with the book', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    // Every word here except the distinctive ones appears in the page; that must not be enough.
    const points = ['The pod uses a PriorityClass so the scheduler preempts lower-priority pods'];
    const page = pageWith('the pod uses a label so the controller matches other pods');
    expect(uncoveredPoints(book(points), page)).toHaveLength(1);
  });
});
