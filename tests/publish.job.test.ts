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
    const { reviewFile, GATES_VERSION } = await import('@/lib/digital/review');
    o?.onStep?.('review'); o?.onReviewStep?.('rules'); o?.onReviewStep?.('ai'); o?.onReviewStep?.('done');
    const review = { editionHash: editionHash((await loadEdition(s, c))!), generatedAt: new Date().toISOString(), gatesVersion: GATES_VERSION, findings: opts.findings ?? [], verdict: opts.verdict ?? 'pass' };
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

  it('reports a job file left live by a crashed server as not live once it is stale', async () => {
    const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    put('handbooks/py/publish-job.json', { subject: 'py', live: true, startedAt, stage: 'reviews', steps: [] });
    const { readJob } = await import('@/lib/publish/job');
    expect((await readJob('py'))?.live).toBe(false);
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

  it('rereview deletes the saved review and reviews the edition on disk without writing it again', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { reviewFile } = await import('@/lib/digital/review');
    const { readState } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    await finish();
    expect(existsSync(reviewFile('py', 'loop'))).toBe(true);
    m.generateEdition.mockClear();
    const real = m.reviewAndFix.getMockImplementation()!;
    let existedWhenReviewStarted: boolean | null = null;
    m.reviewAndFix.mockClear();
    m.reviewAndFix.mockImplementation(async (...args: unknown[]) => {
      existedWhenReviewStarted = existsSync(reviewFile('py', 'loop'));
      return (real as (...a: unknown[]) => Promise<unknown>)(...args);
    });
    await startPublish('py', ['loop'], { rereview: true });
    const job = await finish();
    expect(m.generateEdition).not.toHaveBeenCalled();
    expect(m.reviewAndFix).toHaveBeenCalledTimes(1);
    expect(existedWhenReviewStarted).toBe(false);
    expect(job.steps.find((x) => x.chapter === 'loop' && x.pass === 'generate')!.state).toBe('skipped');
    expect((await readState('py')).chapters.loop.verdict).toBe('pass');
  });

  it('does not reuse a saved review made by other gates', async () => {
    const m = mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { reviewFile } = await import('@/lib/digital/review');
    await startPublish('py', ['loop']);
    await finish();
    const old = JSON.parse(readFileSync(reviewFile('py', 'loop'), 'utf8'));
    writeFileSync(reviewFile('py', 'loop'), JSON.stringify({ ...old, gatesVersion: 0 }));
    m.reviewAndFix.mockClear();
    await startPublish('py', ['loop']);
    await finish();
    expect(m.reviewAndFix).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected chapter rejected and never approves it when it is reviewed again', async () => {
    mocks();
    const { startPublish } = await import('@/lib/publish/job');
    const { readState, updateState, liveChapters } = await import('@/lib/publish/state');
    await startPublish('py', ['loop']);
    await finish();
    await updateState('py', (st) => { st.chapters.loop.rejected = true; delete st.chapters.loop.approvedBy; });
    put('handbooks/py/loop/book.json', { title: 'loop', summary: 'x', chapters: [{ title: 'a', points: ['p', 'q'] }] });
    await startPublish('py', ['loop']);
    await finish();
    const state = await readState('py');
    expect(state.chapters.loop).toMatchObject({ rejected: true, verdict: 'pass' });
    expect(state.chapters.loop.approvedBy).toBeUndefined();
    expect(liveChapters(state)).toEqual([]);
  });

  it('marks the step that failed as failed and the ones after it as skipped', async () => {
    mocks({ generate: vi.fn().mockRejectedValue(new Error('model said no')) });
    const { startPublish } = await import('@/lib/publish/job');
    await startPublish('py', ['loop']);
    const job = await finish();
    expect(job.steps.filter((x) => x.chapter === 'loop').map((x) => x.state)).toEqual(['failed', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  });

  describe('keepLive', () => {
    const slugs = () => JSON.parse(readFileSync(published(), 'utf8')).chapters.map((c: { slug: string }) => c.slug);
    const loopText = () => JSON.stringify(JSON.parse(readFileSync(published(), 'utf8')).chapters.find((c: { slug: string }) => c.slug === 'loop').parts);
    /** Publishes both chapters, then corrects the loop edition on disk (same inputs, new text). */
    async function corrected(alwaysAsk = false) {
      const m = mocks();
      const job = await import('@/lib/publish/job');
      const { updateState } = await import('@/lib/publish/state');
      const { loadEdition, saveEdition } = await import('@/lib/digital/edition');
      await job.startPublish('py', ['loop', 'tasks']);
      await finish();
      expect(loopText()).toContain('body');
      const e = (await loadEdition('py', 'loop'))!;
      await saveEdition({ ...e, sections: [{ ...e.sections[0], pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text: 'fixed fact' }] }] }] });
      if (alwaysAsk) await updateState('py', (s) => { s.alwaysAsk = true; });
      return { m, ...job };
    }

    it('keeps the old copy live while the corrected text waits for a person, even with Always ask off', async () => {
      const { startPublish } = await corrected();
      const { readState } = await import('@/lib/publish/state');
      await startPublish('py', ['loop'], { rereview: true, keepLive: true });
      await finish();
      const loop = (await readState('py')).chapters.loop;
      expect(loop).toMatchObject({ verdict: 'pass', keepLive: true });
      expect(loop.approvedBy).toBeUndefined();
      expect(slugs()).toEqual(['loop', 'tasks']);
      expect(loopText()).not.toContain('fixed fact');
    });

    it('a rereview without the flag takes the edited chapter out of the file as before', async () => {
      const { startPublish } = await corrected(true);
      const { readState } = await import('@/lib/publish/state');
      await startPublish('py', ['loop'], { rereview: true });
      await finish();
      expect((await readState('py')).chapters.loop.keepLive).toBeUndefined();
      expect(slugs()).toEqual(['tasks']);
    });

    it('clears the flag on a plain run', async () => {
      const { startPublish } = await corrected();
      const { readState } = await import('@/lib/publish/state');
      await startPublish('py', ['loop'], { rereview: true, keepLive: true });
      await finish();
      await startPublish('py', ['loop']);
      await finish();
      expect((await readState('py')).chapters.loop.keepLive).toBeUndefined();
    });

    it('keeps the old copy when the corrected text fails review', async () => {
      const { m, startPublish } = await corrected();
      const real = m.reviewAndFix.getMockImplementation()! as (...a: unknown[]) => Promise<object>;
      m.reviewAndFix.mockImplementation(async (...args: unknown[]) => ({ ...(await real(...args)), verdict: 'fail', findings: [f('rules', 'blocker', 'rules.code')] }));
      await startPublish('py', ['loop'], { rereview: true, keepLive: true });
      await finish();
      // the order is proposed again without the failed chapter, so the held copy keeps its place at the end
      expect(slugs()).toEqual(['tasks', 'loop']);
      expect(loopText()).not.toContain('fixed fact');
    });

    describe('route', () => {
      const ctx = { params: Promise.resolve({ subject: 'py' }) };
      const req = (body: unknown) => new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

      it('answers 400 and starts no job when the chapter is not in the published file', async () => {
        const startPublish = vi.fn().mockResolvedValue({ subject: 'py', live: true });
        vi.doMock('@/lib/publish/job', async (orig) => ({ ...(await orig<object>()), startPublish }));
        put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: 'h', generatedAt: 'now', sections: [] });
        const route = await import('@/app/api/handbooks/[subject]/publish/route');
        const res = await route.POST(req({ action: 'rereview', chapter: 'loop', keepLive: true }), ctx);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/published/);
        expect(startPublish).not.toHaveBeenCalled();
        vi.doUnmock('@/lib/publish/job');
      });

      it('passes the flag on when the chapter is published, and clears it on approve, reject and unselect', async () => {
        const { startPublish: realStart } = await corrected();
        void realStart;
        const startPublish = vi.fn().mockResolvedValue({ subject: 'py', live: true });
        vi.resetModules();
        vi.doMock('@/lib/publish/job', async (orig) => ({ ...(await orig<object>()), startPublish }));
        const route = await import('@/app/api/handbooks/[subject]/publish/route');
        const { updateState, readState } = await import('@/lib/publish/state');
        expect((await route.POST(req({ action: 'rereview', chapter: 'loop', keepLive: true }), ctx)).status).toBe(200);
        expect(startPublish).toHaveBeenCalledWith('py', ['loop'], { rereview: true, keepLive: true });
        for (const action of ['approve', 'reject', 'unselect']) {
          await updateState('py', (s) => { s.chapters.loop.keepLive = true; });
          const body = action === 'unselect' ? { action, chapters: ['loop'] } : { action, chapter: 'loop' };
          expect((await route.POST(req(body), ctx)).status).toBe(200);
          expect((await readState('py')).chapters.loop.keepLive).toBeUndefined();
        }
        vi.doUnmock('@/lib/publish/job');
      });
    });
  });
});
