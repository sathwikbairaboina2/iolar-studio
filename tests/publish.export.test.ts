import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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

async function fixture(extra: Record<string, unknown> = {}) {
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'About python' });
  for (const c of ['loop', 'tasks']) {
    put(`handbooks/py/${c}/chapter.json`, { title: c.toUpperCase(), order: c === 'loop' ? 0 : 1 });
    put(`handbooks/py/${c}/book.json`, { title: c, summary: `${c} summary`, chapters: [{ title: 'a', points: ['p'] }] });
    put(`handbooks/py/${c}/parts/01/post.json`, post(`${c} text {icon:python}`));
  }
  const { chapterHash } = await import('@/lib/publish/hash');
  const ch = (hash: string) => ({ selected: true, verdict: 'pass', hash, reviewedAt: '2026-10-09T00:00:00.000Z', approvedBy: 'ai' });
  put('handbooks/py/publish.json', {
    alwaysAsk: false,
    chapters: { loop: ch(await chapterHash('py', 'loop')), tasks: ch(await chapterHash('py', 'tasks')) },
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
    expect(file.chapters[1]).toMatchObject({ slug: 'tasks', prerequisites: ['loop'], minutes: 1, review: { approvedBy: 'ai' } });
    expect(Object.keys(file.icons)).toEqual(['python']);
  });

  it('drops a chapter that was edited after its review', async () => {
    await fixture();
    put('handbooks/py/tasks/parts/01/post.json', post('changed'));
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
    put('handbooks/py/loop/parts/01/post.json', post('{icon:unknown} {icon:evil} {icon:python}'));
    const { chapterHash } = await import('@/lib/publish/hash');
    const state = JSON.parse(readFileSync(path.join(root, 'handbooks/py/publish.json'), 'utf8'));
    state.chapters.loop.hash = await chapterHash('py', 'loop');
    put('handbooks/py/publish.json', state);
    const { exportSubject } = await import('@/lib/publish/export');
    await exportSubject('py');
    const file = read();
    expect(file.chapters.map((c: { slug: string }) => c.slug)).toContain('loop');
    expect(Object.keys(file.icons)).toEqual(['python']);
    expect(JSON.stringify(file)).not.toContain('onload');
  });
});
