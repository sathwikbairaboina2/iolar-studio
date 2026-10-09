import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const post = (text: string) => ({ brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Page', blocks: [{ type: 'paragraph', text }] }] });
const f = (pass: string, severity: 'blocker' | 'major' | 'minor', rule = `${pass}.ai`) => ({ pass, rule, severity, page: 1, summary: 's', evidence: '', fix: '' });

class Unavail extends Error { constructor() { super('no claude'); this.name = 'ClaudeUnavailableError'; } }

function mocks(opts: { reviewPart?: ReturnType<typeof vi.fn>; digital?: ReturnType<typeof vi.fn>; confidence?: number } = {}) {
  const reviewPart = opts.reviewPart ?? vi.fn().mockResolvedValue({ findings: [], passed: true });
  const digitalReview = opts.digital ?? vi.fn().mockResolvedValue([]);
  const proposeOrder = vi.fn().mockImplementation(async (_s: string, chapters: { slug: string }[]) => ({
    order: chapters.map((c) => c.slug), prerequisites: {}, gaps: [], overlaps: [], confidence: opts.confidence ?? 0.9,
  }));
  vi.doMock('@/lib/verify/review', async (orig) => ({ ...(await orig<object>()), reviewPart, reviewIsCurrent: vi.fn().mockResolvedValue(false), loadReview: vi.fn().mockResolvedValue(null) }));
  vi.doMock('@/lib/publish/digital', async (orig) => ({ ...(await orig<object>()), digitalReview }));
  vi.doMock('@/lib/publish/order', async (orig) => ({ ...(await orig<object>()), proposeOrder }));
  vi.doMock('@/lib/publish/verdict', async (orig) => ({ ...(await orig<object>()), partReviewsFor: vi.fn().mockResolvedValue({ current: true, findings: [[]] }) }));
  vi.doMock('@/lib/renderer/icons', async (orig) => ({ ...(await orig<object>()), iconSvg: () => '' }));
  return { reviewPart, digitalReview, proposeOrder };
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/verify/review'); vi.doUnmock('@/lib/publish/digital'); vi.doUnmock('@/lib/publish/order'); vi.doUnmock('@/lib/publish/verdict');
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
    expect(m.reviewPart).toHaveBeenCalledTimes(2);
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
    m.reviewPart.mockClear();
    m.proposeOrder.mockClear();
    await startPublish('py', ['loop', 'tasks']);
    const job = await finish();
    expect(m.reviewPart).not.toHaveBeenCalled();
    expect(m.proposeOrder).not.toHaveBeenCalled();
    expect(job.steps.filter((s) => s.pass === 'reviews' || s.pass === 'digital').every((s) => s.state === 'skipped')).toBe(true);
  });

  it('refuses a second run for the same subject while one is live', async () => {
    mocks({ reviewPart: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r({ findings: [], passed: true }), 150))) });
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
    mocks({ reviewPart: vi.fn().mockRejectedValue(new Unavail()) });
    const { startPublish } = await import('@/lib/publish/job');
    const { readState, liveChapters } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(job.message).toBe('Claude is not available; reviews could not run');
    const state = await readState('py');
    expect(state.chapters.loop.verdict).toBe('unsure');
    expect(liveChapters(state)).toEqual([]);
    expect(existsSync(published())).toBe(false);
  });

  it('marks a chapter failed on a blocker and keeps it out of the export', async () => {
    mocks({ digital: vi.fn().mockResolvedValue([f('digital', 'blocker')]) });
    const { startPublish } = await import('@/lib/publish/job');
    const { readState } = await import('@/lib/publish/state');
    await startPublish('py', ['loop', 'tasks']);
    await finish();
    expect((await readState('py')).chapters.loop.verdict).toBe('fail');
    expect(existsSync(published())).toBe(false);
  });
});
