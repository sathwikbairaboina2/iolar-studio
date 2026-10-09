import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

const clean = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'PY', date: 'd',
  slides: [{ page_title: 'Lists', blocks: [
    { type: 'heading', text: '1. Lists' },
    { type: 'code', lang: 'python', lines: ['xs = [1, 2]', 'xs.append(3)', 'print(xs)  # [1, 2, 3]'], runnable: true },
  ] }],
  caption: { text: 'Hook first. Then the point.', hashtags: ['#a', '#b', '#c', '#d', '#e'] },
});

const broken = (): Post => validatePost({
  ...clean(),
  slides: [{ page_title: 'Lists', blocks: [
    { type: 'heading', text: '1. Lists' },
    { type: 'code', lang: 'python', lines: ['    def __next__(s):', '        return 1'] },
  ] }],
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-review-'));
  vi.resetModules();
});

function mockClaude(findings: unknown[] = []) {
  vi.doMock('@/lib/ai/claude', () => ({
    runClaude: vi.fn().mockResolvedValue(JSON.stringify({ findings })),
    ClaudeUnavailableError: class extends Error {},
  }));
}

describe('reviewPart', () => {
  it('passes clean content and writes review.json', async () => {
    mockClaude();
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    await savePost('python', 'lists', 1, clean());

    const { reviewPart, reviewFile } = await import('@/lib/verify/review');
    const review = await reviewPart('python', 'lists', 1);

    expect(review.passed).toBe(true);
    expect(review.findings.filter((f) => f.severity === 'blocker')).toEqual([]);
    expect(existsSync(reviewFile('python', 'lists', 1))).toBe(true);
  }, 60_000);

  it('fails content whose code is structurally broken', async () => {
    mockClaude();
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    await savePost('python', 'lists', 1, broken());

    const { reviewPart } = await import('@/lib/verify/review');
    const review = await reviewPart('python', 'lists', 1);

    expect(review.passed).toBe(false);
    expect(review.findings.some((f) => f.rule === 'code.severed')).toBe(true);
  }, 60_000);

  it('merges AI findings and orders blockers first', async () => {
    mockClaude([
      { severity: 'minor', page: 1, summary: 'Caption could be punchier.', evidence: 'x', fix: 'y' },
      { severity: 'blocker', page: 1, summary: 'Claims list append is O(n).', evidence: 'O(n)', fix: 'Say O(1) amortised.' },
    ]);
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    await savePost('python', 'lists', 1, clean());

    const { reviewPart } = await import('@/lib/verify/review');
    const review = await reviewPart('python', 'lists', 1);

    expect(review.findings[0].severity).toBe('blocker');
    expect(review.passed).toBe(false);
    expect(review.findings.some((f) => f.pass === 'facts')).toBe(true);
  }, 60_000);

  it('fails content with a major factual error, but not a major of another kind', async () => {
    const { reviewPassed } = await import('@/lib/verify/review');
    const f = (pass: string, severity: 'blocker' | 'major' | 'minor') => ({ pass, rule: `${pass}.ai`, severity, page: 1, summary: 's', evidence: 'e', fix: 'f' });
    // Wrong content must not publish; a thin page or a teaching-order nit may.
    expect(reviewPassed([f('facts', 'major')])).toBe(false);
    expect(reviewPassed([f('visual', 'major'), f('pedagogy', 'major'), f('facts', 'minor')])).toBe(true);
    expect(reviewPassed([f('code', 'blocker')])).toBe(false);
  });

  it("tells the reviewers what the chapter's other parts cover", async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify({ findings: [] }));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    await savePost('python', 'lists', 1, clean());
    const second = clean();
    second.slides[0].page_title = 'NamedTuple vs TypedDict';
    await savePost('python', 'lists', 2, second);

    const { reviewPart } = await import('@/lib/verify/review');
    await reviewPart('python', 'lists', 1);

    // A part judged alone reports the next part's topics as missing coverage.
    const prompts = runClaude.mock.calls.map((c) => String(c[0]));
    const told = prompts.filter((p) => p.includes('NamedTuple vs TypedDict'));
    expect(told.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('treats a stale review as not current', async () => {
    mockClaude();
    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    await savePost('python', 'lists', 1, clean());

    const { reviewPart, reviewIsCurrent } = await import('@/lib/verify/review');
    await reviewPart('python', 'lists', 1);
    expect(await reviewIsCurrent('python', 'lists', 1)).toBe(true);

    await new Promise((r) => setTimeout(r, 1100));
    await savePost('python', 'lists', 1, clean());
    expect(await reviewIsCurrent('python', 'lists', 1)).toBe(false);
  }, 60_000);
});
