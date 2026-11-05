import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/renderer/icons', async (orig) => ({
  ...(await orig<object>()),
  iconSvg: (n: string) => (n === 'python' ? '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' : n === 'evil' ? '<svg onload="x()"><path d="M0 0"/></svg>' : ''),
}));

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const post = (text: string) => ({ brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Page', blocks: [{ type: 'paragraph', text }] }] });
const editionOf = (chapter: string, text: string, inputsHash: string) => ({
  schema: 1, subject: 'py', chapter, inputsHash, generatedAt: '2026-10-09T00:00:00.000Z',
  sections: [
    { title: 'Intro', role: 'intro', pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text }] }] },
    { title: 'Main', role: 'outline', outlineIndex: 0, pages: [{ title: 'Body', blocks: [{ type: 'paragraph', text: 'body words '.repeat(200) }] }] },
  ],
});
/** Writes the chapter's edition and returns the state entry that matches it. */
async function publishedChapter(chapter: string, text: string) {
  const { chapterHash } = await import('@/lib/publish/hash');
  const { editionHash } = await import('@/lib/digital/edition');
  const hash = await chapterHash('py', chapter);
  const e = editionOf(chapter, text, hash);
  put(`handbooks/py/${chapter}/digital/edition.json`, e);
  return { selected: true, verdict: 'pass', hash, editionHash: editionHash(e as never), reviewedAt: '2026-10-09T00:00:00.000Z', approvedBy: 'ai' };
}

async function fixture(extra: Record<string, unknown> = {}) {
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'About python' });
  for (const c of ['loop', 'tasks']) {
    put(`handbooks/py/${c}/chapter.json`, { title: c.toUpperCase(), order: c === 'loop' ? 0 : 1 });
    put(`handbooks/py/${c}/book.json`, { title: c, summary: `${c} summary`, chapters: [{ title: 'a', points: ['p'] }] });
    put(`handbooks/py/${c}/parts/01/post.json`, post(`${c} text {icon:python}`));
  }
  put('handbooks/py/publish.json', {
    alwaysAsk: false,
    chapters: { loop: await publishedChapter('loop', 'loop text {icon:python}'), tasks: await publishedChapter('tasks', 'tasks text {icon:python}') },
    order: { order: ['loop', 'tasks'], prerequisites: { tasks: ['loop'] }, gaps: [], overlaps: [], confidence: 0.9, approvedBy: 'ai', basis: 'b' },
    ...extra,
  });
}
const out = () => path.join(root, 'published', 'py.handbook.json');
const read = () => JSON.parse(readFileSync(out(), 'utf8'));

beforeEach(() => { vi.resetModules(); root = mkdtempSync(path.join(tmpdir(), 'exp-')); process.env.IOLAR_DATA_DIR = root; });

describe('exportSubject', () => {
  it('writes a file the contract accepts, in the approved order', async () => {
    await fixture();
    const { exportSubject } = await import('@/lib/publish/export');
    const { parseHandbook } = await import('@/lib/publish/contract');
    expect(await exportSubject('py')).toMatchObject({ written: true, chapters: 2 });
    const file = read();
    expect(parseHandbook(file).ok).toBe(true);
    expect(file.order).toEqual(['loop', 'tasks']);
    expect(file.orderReview.approvedBy).toBe('ai');
    expect(file.chapters[1]).toMatchObject({ slug: 'tasks', summary: 'tasks summary', prerequisites: ['loop'], minutes: 2, review: { approvedBy: 'ai', passes: ['rules', 'facts', 'pedagogy', 'readability'] } });
    expect(file.chapters[1].parts.map((p: { n: number; title: string }) => [p.n, p.title])).toEqual([[1, 'Intro'], [2, 'Main']]);
    expect(file.chapters[1].parts[1].pages[0].title).toBe('Body');
    expect(Object.keys(file.icons)).toEqual(['python']);
  });

  it('drops a chapter whose post was edited after its review', async () => {
    await fixture();
    put('handbooks/py/tasks/parts/01/post.json', post('changed'));
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
  });

  it('drops a chapter whose book.json was edited, and one whose edition no longer matches its review', async () => {
    await fixture();
    put('handbooks/py/tasks/book.json', { title: 'tasks', summary: 'new', chapters: [{ title: 'a', points: ['p', 'q'] }] });
    const e = JSON.parse(readFileSync(path.join(root, 'handbooks/py/loop/digital/edition.json'), 'utf8'));
    e.sections[0].title = 'Edited by hand';
    put('handbooks/py/loop/digital/edition.json', e);
    const { exportSubject } = await import('@/lib/publish/export');
    expect(await exportSubject('py')).toMatchObject({ written: false, chapters: 0 });
    expect(existsSync(out())).toBe(false);
  });

  it('drops a chapter that has no edition', async () => {
    await fixture();
    rmSync(path.join(root, 'handbooks/py/tasks/digital'), { recursive: true });
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
  });

  it('drops an unselected chapter, and deletes the file when none is left', async () => {
    await fixture();
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    const state = JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    state.chapters.tasks.selected = false;
    put('handbooks/py/publish.json', state);
    await exportSubject('py');
    expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
    expect(read().order).toEqual(['loop']);
    state.chapters.loop.selected = false;
    put('handbooks/py/publish.json', state);
    expect(await exportSubject('py')).toMatchObject({ written: false, chapters: 0 });
    expect(existsSync(out())).toBe(false);
  });

  it('leaves the previous file alone while the order is not approved', async () => {
    await fixture();
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    const before = readFileSync(out(), 'utf8');
    const state = JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    delete state.order.approvedBy;
    put('handbooks/py/publish.json', state);
    expect(await exportSubject('py')).toMatchObject({ written: false });
    expect(readFileSync(out(), 'utf8')).toBe(before);
  });

  it('still removes a rejected chapter while the order waits for approval', async () => {
    await fixture();
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    const state = JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    delete state.order.approvedBy;
    state.chapters.tasks.rejected = true;
    put('handbooks/py/publish.json', state);
    await exportSubject('py');
    expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
    expect(read().order).toEqual(['loop']);
  });

  it('keeps a chapter with an unknown icon and never embeds unsafe svg', async () => {
    await fixture();
    const state = JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    state.chapters.loop = await publishedChapter('loop', '{icon:unknown} {icon:evil} {icon:python}');
    put('handbooks/py/publish.json', state);
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    const file = read();
    expect(file.chapters.map((c: { slug: string }) => c.slug)).toContain('loop');
    expect(Object.keys(file.icons)).toEqual(['python']);
    expect(JSON.stringify(file)).not.toContain('onload');
  });

  it('records exportedAt without losing a change another caller is making to the state', async () => {
    await fixture();
    const { exportSubject } = await import('@/lib/publish/export');
    const { updateState, readState } = await import('@/lib/publish/state');
    const slow = updateState('py', async (st) => {
      await new Promise((r) => setTimeout(r, 150));
      st.alwaysAsk = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    await Promise.all([exportSubject('py'), slow]);
    const state = await readState('py');
    expect(state.alwaysAsk).toBe(true);
    expect(state.exportedAt).toBe(read().updatedAt);
  });

  it('never exports one subject twice at the same time, and still writes a valid file', async () => {
    await fixture();
    let active = 0;
    let most = 0;
    vi.doMock('@/lib/publish/hash', async (orig) => {
      const real = await orig<typeof import('@/lib/publish/hash')>();
      return { ...real, chapterHash: async (s: string, c: string) => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 15)); const h = await real.chapterHash(s, c); active--; return h; } };
    });
    const { exportSubject } = await import('@/lib/publish/export');
    const { parseHandbook } = await import('@/lib/publish/contract');
    const results = await Promise.all([exportSubject('py'), exportSubject('py'), exportSubject('py'), exportSubject('py')]);
    expect(results.every((r) => r.written)).toBe(true);
    expect(most).toBe(1);
    expect(parseHandbook(read()).ok).toBe(true);
    vi.doUnmock('@/lib/publish/hash');
  });

  describe('keepLive', () => {
    const stateNow = () => JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    /** Exports once, then replaces loop with a corrected, not yet approved edition held by keepLive. */
    async function heldLoop(extra: Record<string, unknown> = {}) {
      await fixture();
      const { exportSubject } = await import('@/lib/publish/export');
      await exportSubject('py');
      const before = readFileSync(out(), 'utf8');
      const fresh = await publishedChapter('loop', 'corrected text {icon:python}');
      delete (fresh as { approvedBy?: string }).approvedBy;
      const state = stateNow();
      state.chapters.loop = { ...fresh, keepLive: true, ...extra };
      put('handbooks/py/publish.json', state);
      return { exportSubject, before: JSON.parse(before), state };
    }

    it('keeps the previous entry byte for byte while the correction waits, and leaves other chapters alone', async () => {
      const { exportSubject, before } = await heldLoop();
      expect(await exportSubject('py')).toMatchObject({ written: true, chapters: 2 });
      const file = read();
      expect(file.order).toEqual(['loop', 'tasks']);
      expect(file.chapters[0]).toEqual(before.chapters[0]);
      expect(JSON.stringify(file.chapters[0])).toContain('loop text');
      expect(JSON.stringify(file.chapters[0])).not.toContain('corrected');
      expect(file.chapters[1]).toEqual(before.chapters[1]);
      expect(Object.keys(file.icons)).toEqual(['python']);
    });

    it('publishes the new text once it is approved and the flag is gone', async () => {
      const { exportSubject, state } = await heldLoop();
      state.chapters.loop = { ...state.chapters.loop, approvedBy: 'human', approvedAt: 'now' };
      delete state.chapters.loop.keepLive;
      put('handbooks/py/publish.json', state);
      await exportSubject('py');
      expect(JSON.stringify(read().chapters[0])).toContain('corrected text');
      expect(JSON.stringify(read().chapters[0])).not.toContain('loop text');
    });

    it('lets a rejected or unselected chapter leave the file', async () => {
      const { exportSubject, state } = await heldLoop();
      state.chapters.loop.rejected = true;
      put('handbooks/py/publish.json', state);
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['tasks']);
      delete state.chapters.loop.rejected;
      state.chapters.loop.selected = false;
      put('handbooks/py/publish.json', state);
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['tasks']);
    });

    it('still drops an edited chapter that is not held', async () => {
      const { exportSubject, state } = await heldLoop();
      delete state.chapters.loop.keepLive;
      put('handbooks/py/publish.json', state);
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['tasks']);
    });

    it('keeps a held chapter in the file while the order waits for approval', async () => {
      const { exportSubject, state } = await heldLoop();
      delete state.order.approvedBy;
      put('handbooks/py/publish.json', state);
      expect(await exportSubject('py')).toMatchObject({ written: false });
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop', 'tasks']);
      expect(JSON.stringify(read().chapters[0])).not.toContain('corrected');
    });

    it('does not delete the file when only held chapters remain', async () => {
      const { exportSubject, state } = await heldLoop();
      state.chapters.tasks.selected = false;
      put('handbooks/py/publish.json', state);
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop']);
      expect(read().order).toEqual(['loop']);
      expect(JSON.stringify(read().chapters[0])).not.toContain('corrected');
    });

    it('keeps the old copy when the corrected text failed review', async () => {
      const { exportSubject } = await heldLoop({ verdict: 'fail' });
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['loop', 'tasks']);
      expect(JSON.stringify(read().chapters[0])).not.toContain('corrected');
    });

    it('leaves out a held chapter that has no previous entry', async () => {
      const { exportSubject } = await heldLoop();
      rmSync(out());
      await exportSubject('py');
      expect(read().chapters.map((c: { slug: string }) => c.slug)).toEqual(['tasks']);
    });
  });

  it('uses a different temporary file for every write', async () => {
    await fixture();
    const fs = await import('fs');
    const renames: string[] = [];
    const real = fs.promises.rename;
    const spy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (a, b) => { renames.push(String(a)); return real(a, b); });
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    await exportSubject('py');
    spy.mockRestore();
    const handbookTmp = renames.filter((r) => r.includes('py.handbook.json'));
    expect(handbookTmp).toHaveLength(2);
    expect(new Set(handbookTmp).size).toBe(2);
  });
});
