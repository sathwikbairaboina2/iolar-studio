import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const qaBook = {
  title: '5 API Interview Questions',
  summary: 'The questions they ask.',
  chapters: [
    { title: 'HTTP basics', points: ['What is REST?', 'GET vs POST?', 'What is idempotency?'] },
    { title: 'Auth', points: ['JWT vs session?', 'What is OAuth 2.0?'] },
  ],
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-cat-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar' }));
  vi.resetModules();
});

describe('chapter category', () => {
  it('is stored on create, read back in the meta, and defaults to handbook for old chapters', async () => {
    const { createSubject, createChapter, loadChapterMeta, chapterCategory } = await import('@/lib/store');
    await createSubject('api');
    expect((await createChapter('api', 'qa', 'API Q&A', 'interview-qa')).category).toBe('interview-qa');
    expect(await chapterCategory('api', 'qa')).toBe('interview-qa');
    expect((await createChapter('api', 'old', 'Old')).category).toBe('handbook');
    expect((await loadChapterMeta('api', 'old')).category).toBe('handbook');
  });

  it('rejects a category this build does not know', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('api');
    await expect(createChapter('api', 'bad', 'Bad', 'poster' as never)).rejects.toThrow(/category/);
  });

  it("feeds the category's page rules and the page's question range into the page prompt", async () => {
    const { chapterPrompt } = await import('@/lib/ai/pages');
    const p = chapterPrompt({ brand: 'iolar', template: 'study-sheet', book: qaBook as never, index: 1, prior: [], category: 'interview-qa' });
    expect(p).toContain('Interview Q&A Bank');
    expect(p).toContain('"Q<n>. <question>"');
    expect(p).toContain('Q4 to Q5');
    // A classic handbook page gets no item range.
    expect(chapterPrompt({ brand: 'iolar', template: 'study-sheet', book: qaBook as never, index: 1, prior: [] })).not.toContain('Q4 to Q5');
  });

  it("puts the category's caption rules and call to action in the caption prompt", async () => {
    const { captionPrompt } = await import('@/lib/ai/pages');
    const p = captionPrompt(qaBook as never, 'iolar', 'interview-qa');
    expect(p).toContain('Hook with the count');
    expect(p).toContain('Comment “api” to get all the answers');
  });

  it("builds the book with the category's guidance", async () => {
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify(qaBook));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('api');
    await createChapter('api', 'qa', 'API Q&A', 'interview-qa');
    const { bookFromTopic } = await import('@/lib/ai/book');
    await bookFromTopic('api', 'qa', 'REST APIs');
    const prompt = String(runClaude.mock.calls[0][0]);
    expect(prompt).toContain('Each point IS one question');
    expect(prompt).toContain('question → short answer → key points → visual');
  });

  it('reports category gate findings in the review gates', async () => {
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn(), ClaudeUnavailableError: class extends Error {} }));
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('db');
    await createChapter('db', 'ten', '10 DB Concepts', 'listicle');
    const { saveBook } = await import('@/lib/ai/book');
    await saveBook('db', 'ten', { title: '10 Database Concepts', summary: 's', chapters: [
      { title: 'Replication', points: ['copies of data'] }, { title: 'replication', points: ['read replicas scale reads'] },
    ] });
    const { runGates } = await import('@/lib/verify/runGates');
    const rules = (await runGates('db', 'ten', 1)).map((f) => f.rule);
    expect(rules).toContain('category.duplicate-title');
    expect(rules).toContain('category.count');
  }, 60_000);
  it('is accepted on create and changeable through the chapter API', async () => {
    const { createSubject } = await import('@/lib/store');
    await createSubject('api');
    const subjectRoute = await import('@/app/api/handbooks/[subject]/route');
    const created = await subjectRoute.POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ slug: 'ten', title: '10 Concepts', category: 'listicle' }) }),
      { params: Promise.resolve({ subject: 'api' }) });
    expect((await created.json()).category).toBe('listicle');

    const chapterRoute = await import('@/app/api/handbooks/[subject]/[chapter]/route');
    const ctx = { params: Promise.resolve({ subject: 'api', chapter: 'ten' }) };
    const moved = await chapterRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ category: 'drills' }) }), ctx);
    expect((await moved.json()).chapter).toMatchObject({ category: 'drills', title: '10 Concepts' });
    const bad = await chapterRoute.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ category: 'poster' }) }), ctx);
    expect(bad.status).toBe(400);
  });
});
