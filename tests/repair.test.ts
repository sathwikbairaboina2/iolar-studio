import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

const post = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: '29/08/2026',
  slides: [{
    page_title: 'Pods',
    blocks: [
      { type: 'bullets', items: ['a pod holds containers'] },
      { type: 'paragraph', text: 'Containers in a pod share a network namespace.' },
    ],
  }],
  caption: { text: '', hashtags: [] },
});

const BOOK = {
  title: 'Kubernetes Pods',
  summary: 'What a pod is and how it is scheduled.',
  chapters: [{
    title: 'Basics',
    points: [
      'a pod holds containers that share a network namespace',
      'requests are for the scheduler, limits are enforced by the kubelet',
    ],
  }],
};

async function seed() {
  const { createSubject, createChapter, savePost } = await import('@/lib/store');
  const { bookFile } = await import('@/lib/paths');
  await createSubject('k8s');
  await createChapter('k8s', 'pods', 'Pods');
  await savePost('k8s', 'pods', 1, post());
  writeFileSync(bookFile('k8s', 'pods'), JSON.stringify(BOOK));
}

/** The proposal a well-behaved repair returns: the original page plus one that fills the gap. */
function withRecovery(): Post {
  const p = post();
  p.slides.push({
    page_title: 'Requests and Limits',
    blocks: [{
      type: 'bullets',
      items: ['requests guide the scheduler', 'limits are enforced by the kubelet'],
    }],
  });
  return p;
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-repair-'));
  vi.resetModules();
});

const mockClaude = (reply: unknown) => vi.doMock('@/lib/ai/runner', () => ({
  thinker: () => vi.fn().mockResolvedValue(typeof reply === 'string' ? reply : JSON.stringify(reply)),
  provider: () => 'claude',
  onClaude: () => true,
  NoLocalToolsError: class extends Error {},
}));

describe('chapterGaps', () => {
  it('reports book points the pages no longer cover', async () => {
    await seed();
    const { chapterGaps } = await import('@/lib/ai/repair');
    const gaps = await chapterGaps('k8s', 'pods');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('requests are for the scheduler');
  });
});

describe('repairCoverage', () => {
  it('appends pages that restore the missing points', async () => {
    await seed();
    mockClaude(withRecovery());
    const { repairCoverage } = await import('@/lib/ai/repair');
    const { loadPost } = await import('@/lib/store');

    const result = await repairCoverage('k8s', 'pods');
    expect(result).toMatchObject({ part: 1, missingBefore: 1, missingAfter: 0 });
    expect(result!.recovered[0]).toContain('requests are for the scheduler');

    const saved = await loadPost('k8s', 'pods', 1);
    expect(saved.slides).toHaveLength(2);
    // The page that was already there is untouched.
    expect(saved.slides[0]).toEqual(post().slides[0]);
  });

  it('returns null when the chapter already covers its book', async () => {
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    const { bookFile } = await import('@/lib/paths');
    await createSubject('k8s');
    await createChapter('k8s', 'pods', 'Pods');
    await savePost('k8s', 'pods', 1, withRecovery());
    writeFileSync(bookFile('k8s', 'pods'), JSON.stringify(BOOK));

    mockClaude('{}');
    const { repairCoverage } = await import('@/lib/ai/repair');
    expect(await repairCoverage('k8s', 'pods')).toBeNull();
  });

  it('rejects a proposal that removes content', async () => {
    await seed();
    const stripped = post();
    stripped.slides[0].blocks = stripped.slides[0].blocks.slice(0, 1);
    mockClaude(stripped);

    const { repairCoverage } = await import('@/lib/ai/repair');
    const { loadPost } = await import('@/lib/store');
    await expect(repairCoverage('k8s', 'pods')).rejects.toThrow(/removed content/);
    expect((await loadPost('k8s', 'pods', 1)).slides[0].blocks).toHaveLength(2);
  });

  it('reverts a proposal that covers none of the gaps', async () => {
    await seed();
    const useless = post();
    useless.slides.push({ page_title: 'Filler', blocks: [{ type: 'paragraph', text: 'nothing new here' }] });
    mockClaude(useless);

    const { repairCoverage } = await import('@/lib/ai/repair');
    const { loadPost } = await import('@/lib/store');
    await expect(repairCoverage('k8s', 'pods')).rejects.toThrow(/covered none/);
    expect((await loadPost('k8s', 'pods', 1)).slides).toHaveLength(1);
  });
});

describe('coverage route', () => {
  const ctx = { params: Promise.resolve({ subject: 'k8s', chapter: 'pods' }) };
  const req = (method: string) => new Request('http://t/api', { method });

  it('reports the gaps a chapter has', async () => {
    await seed();
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/coverage/route');
    const body = await (await route.GET(req('GET'), ctx)).json();
    expect(body.complete).toBe(false);
    expect(body.missing[0]).toContain('requests are for the scheduler');
  });

  it('repairs on POST and reports what it recovered', async () => {
    await seed();
    mockClaude(withRecovery());
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/coverage/route');
    const body = await (await route.POST(req('POST'), ctx)).json();
    expect(body.repair).toMatchObject({ part: 1, missingAfter: 0 });
  });

  it('answers 500 rather than throwing when the repair is rejected', async () => {
    await seed();
    const useless = post();
    useless.slides.push({ page_title: 'Filler', blocks: [{ type: 'paragraph', text: 'nothing new here' }] });
    mockClaude(useless);
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/coverage/route');
    const res = await route.POST(req('POST'), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/covered none/);
  });
});
