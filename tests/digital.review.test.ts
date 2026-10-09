import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const f = (pass: string, severity: 'blocker' | 'major' | 'minor', rule = `${pass}.ai`, page = 1) => ({ pass, rule, severity, page, summary: 's', evidence: '', fix: '' });

const edition = () => ({
  schema: 1 as const, subject: 'py', chapter: 'loop', inputsHash: 'h', generatedAt: '2026-10-09T00:00:00.000Z',
  sections: [{ title: 'Intro', role: 'intro' as const, pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text: 'Hello **world**' }] }] }],
});

function mocks(byPass: Record<string, ReturnType<typeof f>[]> = {}, gates: ReturnType<typeof f>[] = []) {
  const askClaude = vi.fn().mockImplementation(async (pass: string) => byPass[pass] ?? []);
  vi.doMock('@/lib/verify/review', async (orig) => ({ ...(await orig<object>()), askClaude }));
  vi.doMock('@/lib/digital/gates', () => ({ editionGates: vi.fn().mockResolvedValue(gates) }));
  return askClaude;
}

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock('@/lib/verify/review'); vi.doUnmock('@/lib/digital/gates');
  root = mkdtempSync(path.join(tmpdir(), 'rev-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/loop/chapter.json', { title: 'Loop', order: 0 });
  put('handbooks/py/loop/book.json', { title: 'Loop', summary: 's', chapters: [{ title: 'a', points: ['p'] }] });
  put('handbooks/py/loop/digital/edition.json', edition());
});

describe('reviewEdition', () => {
  it('passes with only minor findings and saves the review', async () => {
    mocks({ readability: [f('readability', 'minor')] }, [f('rules', 'minor', 'rules.markdown')]);
    const { reviewEdition, loadEditionReview } = await import('@/lib/digital/review');
    const r = await reviewEdition('py', 'loop');
    expect(r.verdict).toBe('pass');
    expect(r.findings).toHaveLength(2);
    expect(await loadEditionReview('py', 'loop')).toEqual(r);
  });

  it('fails on a major facts finding or a rules blocker', async () => {
    mocks({ facts: [f('facts', 'major')] });
    const { reviewEdition } = await import('@/lib/digital/review');
    expect((await reviewEdition('py', 'loop')).verdict).toBe('fail');
    vi.resetModules();
    mocks({}, [f('rules', 'blocker', 'rules.code')]);
    const again = await import('@/lib/digital/review');
    expect((await again.reviewEdition('py', 'loop')).verdict).toBe('fail');
  });

  it('is unsure on a pedagogy major or an unavailable pass', async () => {
    mocks({ pedagogy: [f('pedagogy', 'major')] });
    const a = await import('@/lib/digital/review');
    expect((await a.reviewEdition('py', 'loop')).verdict).toBe('unsure');
    vi.resetModules();
    mocks({ facts: [f('facts', 'minor', 'facts.unavailable', 0)] });
    const b = await import('@/lib/digital/review');
    expect((await b.reviewEdition('py', 'loop')).verdict).toBe('unsure');
  });

  it('sends the page-numbered edition text to the passes, with web search for facts only', async () => {
    const ask = mocks();
    const { reviewEdition } = await import('@/lib/digital/review');
    await reviewEdition('py', 'loop');
    const facts = ask.mock.calls.find((c) => c[0] === 'facts')!;
    expect(facts[1]).toContain('### Page 1: Start');
    expect(facts[1]).toContain('Hello world');
    expect(facts[2]).toEqual(['WebSearch', 'WebFetch']);
    expect(ask.mock.calls.find((c) => c[0] === 'pedagogy')![2]).toBeUndefined();
    expect(ask.mock.calls.map((c) => c[0]).sort()).toEqual(['facts', 'pedagogy', 'readability']);
  });

  it('currentReview is null once the edition changes', async () => {
    mocks();
    const { reviewEdition, currentReview } = await import('@/lib/digital/review');
    await reviewEdition('py', 'loop');
    expect(await currentReview('py', 'loop')).not.toBeNull();
    const e = edition();
    e.sections[0].title = 'Changed';
    put('handbooks/py/loop/digital/edition.json', e);
    expect(await currentReview('py', 'loop')).toBeNull();
  });

  it('currentReview is null when there is no review', async () => {
    const { currentReview } = await import('@/lib/digital/review');
    expect(await currentReview('py', 'loop')).toBeNull();
  });
});
