import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const post = (text: string) => ({ brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Page', blocks: [{ type: 'paragraph', text }] }] });
const f = (pass: string, severity: 'blocker' | 'major' | 'minor', rule = `${pass}.ai`) => ({ pass, rule, severity, page: 1, summary: 's', evidence: '', fix: '' });

class Unavail extends Error { constructor() { super('no claude'); this.name = 'ClaudeUnavailableError'; } }

const edition = (chapter: string, inputsHash: string, text = 'body') => ({
  schema: 1 as const, subject: 'py', chapter, inputsHash, generatedAt: '2026-10-09T00:00:00.000Z',
  sections: [{ title: 'Intro', role: 'intro' as const, pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text }] }] }],
});

type Opts = { generate?: ReturnType<typeof vi.fn>; fix?: ReturnType<typeof vi.fn>; confidence?: number; findings?: ReturnType<typeof f>[]; verdict?: 'pass' | 'unsure' | 'fail' };
function mocks(opts: Opts = {}) {
  const generateEdition = opts.generate ?? vi.fn().mockImplementation(async (s: string, c: string) => {
    const { inputsHash, saveEdition } = await import('@/lib/digital/edition');
    const h = await inputsHash(s, c);
    const e = edition(c, h, `body ${h}`);
    await saveEdition(e);
    return e;
  });
  const reviewAndFix = opts.fix ?? vi.fn().mockImplementation(async (s: string, c: string, o?: { onStep?: (x: string) => void; onReviewStep?: (x: string) => void }) => {
    const { loadEdition, editionHash } = await import('@/lib/digital/edition');
    const { reviewFile } = await import('@/lib/digital/review');
    o?.onStep?.('review'); o?.onReviewStep?.('rules'); o?.onReviewStep?.('ai'); o?.onReviewStep?.('done');
    const review = { editionHash: editionHash((await loadEdition(s, c))!), generatedAt: new Date().toISOString(), findings: opts.findings ?? [], verdict: opts.verdict ?? 'pass' };
    mkdirSync(path.dirname(reviewFile(s, c)), { recursive: true });
    writeFileSync(reviewFile(s, c), JSON.stringify(review));
    return review;
  });
  const proposeOrder = vi.fn().mockImplementation(async (_s: string, chapters: { slug: string }[]) => ({
    order: chapters.map((c) => c.slug), prerequisites: {}, gaps: [], overlaps: [], confidence: opts.confidence ?? 0.9,
  }));
  vi.doMock('@/lib/digital/generate', async (orig) => ({ ...(await orig<object>()), generateEdition }));
  vi.doMock('@/lib/digital/fix', async (orig) => ({ ...(await orig<object>()), reviewAndFix }));
  vi.doMock('@/lib/publish/order', async (orig) => ({ ...(await orig<object>()), proposeOrder }));
  vi.doMock('@/lib/renderer/icons', async (orig) => ({ ...(await orig<object>()), iconSvg: () => '' }));
  return { generateEdition, reviewAndFix, proposeOrder };
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/digital/generate'); vi.doUnmock('@/lib/digital/fix'); vi.doUnmock('@/lib/publish/order');
  root = mkdtempSync(path.join(tmpdir(), 'job-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'd' });
  for (const [i, c] of ['loop', 'tasks'].entries()) {
    put(`handbooks/py/${c}/chapter.json`, { title: c, order: i });
    put(`handbooks/py/${c}/book.json`, { title: c, summary: `${c} summary`, chapters: [{ title: 'a', points: ['p'] }] });
    put(`handbooks/py/${c}/parts/01/post.json`, post(`${c} text`));
  }
});

async function finish() {
  const { readJob } = await import('@/lib/publish/job');
  await vi.waitFor(async () => { expect((await readJob('py'))?.live).toBe(false); }, { timeout: 5000 });
  return (await readJob('py'))!;
}
const published = () => path.join(root, 'published', 'py.handbook.json');

describe('publish job', () => {
  it('reviews, proposes the order, exports and finishes', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { readState, liveChapters } = await import('@/lib/publish/state');
    const started = await startPublish('py', ['loop', 'tasks']);
    expect(started.live).toBe(true);
    const job = await finish();
    expect(job).toMatchObject({ stage: 'done', live: false });
    expect(m.generateEdition).toHaveBeenCalledTimes(2);
    expect(m.reviewAndFix).toHaveBeenCalledTimes(2);
    const state = await readState('py');
    expect(state.chapters.loop).toMatchObject({ verdict: 'pass', approvedBy: 'ai' });
    expect(state.order).toMatchObject({ order: ['loop', 'tasks'], approvedBy: 'ai' });
    expect(liveChapters(state).sort()).toEqual(['loop', 'tasks']);
    expect(JSON.parse(readFileSync(published(), 'utf8')).order).toEqual(['loop', 'tasks']);
  });

  it('skips everything on a second run when nothing changed', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    m.generateEdition.mockClear();
    m.reviewAndFix.mockClear();
    m.proposeOrder.mockClear();
    await startPublish('py', ['loop', 'tasks']);
    const job = await finish();
    expect(m.generateEdition).not.toHaveBeenCalled();
    expect(m.reviewAndFix).not.toHaveBeenCalled();
    expect(m.proposeOrder).not.toHaveBeenCalled();
    expect(job.steps.filter((s) => s.pass !== 'order' && s.pass !== 'export').every((s) => s.state === 'skipped')).toBe(true);
  });

  it('refuses a second run for the same subject while one is live', async () => {
    mocks({ generate: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r(edition('loop', 'x')), 150))) });
    const { startPublish } = await import('@/lib/publish/job');
    await startPublish('py', ['loop']);
    await expect(startPublish('py', ['tasks'])).rejects.toThrow('busy');
    await finish();
  });

  it('holds a passing chapter for approval when Always ask me is on', async () => {
    mocks();
    put('handbooks/py/publish.json', { alwaysAsk: true, chapters: {} });
    const { startPublish } = await import('@/lib/publish/job');
    const { readState, queue, liveChapters } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    await finish();
    const state = await readState('py');
    expect(queue(state).chapters).toEqual(['loop']);
    expect(queue(state).order).toBe(true);
    expect(liveChapters(state)).toEqual([]);
    expect(existsSync(published())).toBe(false);
  });

  it('leaves a chapter unsure and says so when Claude is unavailable', async () => {
    mocks({ generate: vi.fn().mockRejectedValue(new Unavail()) });
    const { startPublish } = await import('@/lib/publish/job');
    const { readState, liveChapters } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(job.message).toBe('Claude is not available; reviews could not run');
    const state = await readState('py');
    expect(state.chapters.loop.verdict).toBe('unsure');
    expect(liveChapters(state)).toEqual([]);
    expect(existsSync(published())).toBe(false);
    expect(existsSync(path.join(root, 'handbooks/py/loop/digital/edition.json'))).toBe(false);
  });

  it('marks a chapter failed on a blocker and keeps it out of the export', async () => {
    mocks({ findings: [f('rules', 'blocker', 'rules.code')], verdict: 'fail' });
    const { startPublish } = await import('@/lib/publish/job');
    const { readState } = await import('@/lib/publish/state');
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    expect((await readState('py')).chapters.loop.verdict).toBe('fail');
    expect(existsSync(published())).toBe(false);
  });

  it('exports the edition as the chapter parts and records the edition hash', async () => {
    mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { readState } = await import('@/lib/publish/state');
    const { loadEdition, editionHash, asChapterParts } = await import('@/lib/digital/edition');
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    const e = (await loadEdition('py', 'loop'))!;
    expect((await readState('py')).chapters.loop.editionHash).toBe(editionHash(e));
    const file = JSON.parse(readFileSync(published(), 'utf8'));
    expect(file.chapters[0].parts).toEqual(asChapterParts(e));
  });

  it('regenerates an edited chapter, and the old export leaves the file in between', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { exportSubject } = await import('@/lib/publish/export');
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    put('handbooks/py/tasks/book.json', { title: 'tasks', summary: 'changed', chapters: [{ title: 'a', points: ['p', 'q'] }] });
    await exportSubject('py');
    expect(JSON.parse(readFileSync(published(), 'utf8')).chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
    m.generateEdition.mockClear();
    m.reviewAndFix.mockClear();
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    expect(m.generateEdition.mock.calls.map((c) => c[1])).toEqual(['tasks']);
    expect(m.reviewAndFix.mock.calls.map((c) => c[1])).toEqual(['tasks']);
    expect(JSON.parse(readFileSync(published(), 'utf8')).chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop', 'tasks']);
  });

  it('reuses an edition and review that are still current without calling Claude', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    await startPublish('py', ['loop']);
    await finish();
    rmSync(path.join(root, 'handbooks/py/publish.json'));
    m.generateEdition.mockClear();
    m.reviewAndFix.mockClear();
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(m.generateEdition).not.toHaveBeenCalled();
    expect(m.reviewAndFix).not.toHaveBeenCalled();
    expect(job.steps.filter((s) => s.chapter === 'loop').map((s) => s.state).every((x) => x === 'skipped')).toBe(true);
    const { readState } = await import('@/lib/publish/state');
    expect((await readState('py')).chapters.loop.verdict).toBe('pass');
  });

  it('shows the generate, rules, facts, pedagogy, readability and fix steps per chapter', async () => {
    mocks();
    const { startPublish } = await import('@/lib/publish/job');
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(job.steps.filter((s) => s.chapter === 'loop').map((s) => s.pass)).toEqual(['generate', 'rules', 'facts', 'pedagogy', 'readability', 'fix']);
    expect(job.steps.filter((s) => s.chapter === 'loop').map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'skipped']);
  });

  it('keeps the previous edition and leaves the chapter unsure when regeneration fails', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { readState } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    await finish();
    put('handbooks/py/loop/book.json', { title: 'loop', summary: 'x', chapters: [{ title: 'a', points: ['p', 'q'] }] });
    m.generateEdition.mockRejectedValueOnce(new Unavail());
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(job.message).toBe('Claude is not available; reviews could not run');
    const loop = (await readState('py')).chapters.loop;
    expect(loop.verdict).toBe('unsure');
    expect(loop.editionHash).toBeUndefined();
    expect(existsSync(published())).toBe(false);
  });
});
