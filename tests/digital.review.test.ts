import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
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

  it('states that a wrong quiz answer or wrong example output is major, and raises such a finding', async () => {
    const wrong = { ...f('pedagogy', 'minor'), summary: 'The quiz answer is wrong: it says 3 but the code prints 4.' };
    const ask = mocks({ pedagogy: [wrong] });
    const { reviewEdition } = await import('@/lib/digital/review');
    const r = await reviewEdition('py', 'loop');
    for (const pass of ['facts', 'pedagogy']) {
      expect(ask.mock.calls.find((c) => c[0] === pass)![1]).toMatch(/wrong quiz answer or wrong example output is severity "major"/);
    }
    expect(r.findings[0].severity).toBe('major');
    expect(r.verdict).toBe('unsure');
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

  it('stores the gates version and treats a review made by other gates as not current', async () => {
    mocks();
    const { reviewEdition, currentReview, loadEditionReview, reviewFile, GATES_VERSION } = await import('@/lib/digital/review');
    const r = await reviewEdition('py', 'loop');
    expect(r.gatesVersion).toBe(GATES_VERSION);
    expect(await currentReview('py', 'loop')).not.toBeNull();
    writeFileSync(reviewFile('py', 'loop'), JSON.stringify({ ...(await loadEditionReview('py', 'loop')), gatesVersion: GATES_VERSION - 1 }));
    expect(await currentReview('py', 'loop')).toBeNull();
    const { gatesVersion: _gone, ...unversioned } = r;
    writeFileSync(reviewFile('py', 'loop'), JSON.stringify(unversioned));
    expect(await currentReview('py', 'loop')).toBeNull();
  });

  it('keeps code lines and qa example_code verbatim while stripping inline markup elsewhere', async () => {
    const { editionText } = await import('@/lib/digital/review');
    const e = edition();
    e.sections[0].pages[0].blocks = [
      { type: 'code', lang: 'python', lines: ['entries = 2**32 // 2**12', 'return a == b and c == d', 'def __init__(self):'] },
      { type: 'qa', q: 'Q?', a_bullets: ['a'], example_code: ['x == y'] },
      { type: 'bullets', items: ['**bold** and ==mark=='] },
    ] as never;
    const text = editionText(e);
    for (const l of ['entries = 2**32 // 2**12', 'return a == b and c == d', 'def __init__(self):', 'x == y']) expect(text).toContain(l);
    expect(text).toContain('bold and mark');
  });

  it('is version 5 of the gates, and asks the readability pass whether the page reads as scannable revision notes', async () => {
    const ask = mocks();
    const { reviewEdition, GATES_VERSION } = await import('@/lib/digital/review');
    expect(GATES_VERSION).toBe(5);
    await reviewEdition('py', 'loop');
    const prompt = ask.mock.calls.find((c) => c[0] === 'readability')![1] as string;
    expect(prompt).toMatch(/scannable revision notes/);
    expect(prompt).toMatch(/prose dumps/);
    expect(prompt).toMatch(/one idea per bullet/);
    expect(prompt).toMatch(/visuals/);
  });

  it('names the chapter category to every AI pass, with the intended shape for Q&A banks and drills', async () => {
    const cases: [string, string, string | null][] = [
      ['interview-qa', 'Interview Q&A Bank', 'Pages written as numbered qa blocks without headings are the intended shape for this category.'],
      ['drills', 'Query & Code Drills', 'Numbered task headings each followed by solution code and its result are the intended shape.'],
      ['handbook', 'Complete Handbook', null],
    ];
    for (const [id, name, shape] of cases) {
      vi.resetModules();
      put('handbooks/py/loop/chapter.json', { title: 'Loop', order: 0, category: id });
      const ask = mocks();
      const { reviewEdition } = await import('@/lib/digital/review');
      await reviewEdition('py', 'loop');
      for (const pass of ['facts', 'pedagogy', 'readability']) expect(ask.mock.calls.find((c) => c[0] === pass)![1]).toContain(name);
      for (const pass of ['pedagogy', 'readability']) {
        const prompt = ask.mock.calls.find((c) => c[0] === pass)![1] as string;
        if (shape) expect(prompt).toContain(shape);
        else expect(prompt).not.toMatch(/are the intended shape/);
      }
      expect(ask.mock.calls.find((c) => c[0] === 'facts')![1]).not.toMatch(/are the intended shape/);
    }
  });

  it('still reviews when chapter.json is missing', async () => {
    rmSync(path.join(root, 'handbooks/py/loop/chapter.json'));
    mocks();
    const { reviewEdition } = await import('@/lib/digital/review');
    await expect(reviewEdition('py', 'loop')).resolves.toBeTruthy();
  });

  it('writes a flowchart as edges, not raw ids', async () => {
    const { editionText } = await import('@/lib/digital/review');
    const e = edition();
    e.sections[0].pages[0].blocks = [{
      type: 'diagram', kind: 'flowchart',
      spec: {
        rows: [['q1'], ['a', 'b']],
        nodes: { q1: { text: 'Local or remote?' }, a: { text: 'ARP for host' }, b: { text: 'ARP for gateway' } },
        edges: [{ from: 'q1', to: 'a', label: 'local' }, { from: 'q1', to: 'b', label: 'remote' }],
      },
    }] as never;
    const text = editionText(e);
    expect(text).toContain('Local or remote? --local--> ARP for host');
    expect(text).toContain('Local or remote? --remote--> ARP for gateway');
    expect(text).not.toMatch(/^q1$/m);
    expect(text).not.toContain('rows');
  });

  it('writes a table as one line per row, so cells stay with their columns', async () => {
    const { editionText } = await import('@/lib/digital/review');
    const e = edition();
    e.sections[0].pages[0].blocks = [{
      type: 'table', headers: ['', 'Hub', '**Switch**'],
      rows: [['Forwards', 'every port', 'dest MAC'], ['Duplex', 'half', 'full']], highlightRow: 1,
    }] as never;
    const text = editionText(e);
    expect(text).toContain(' | Hub | Switch');
    expect(text).toContain('Forwards | every port | dest MAC');
    expect(text).toContain('Duplex | half | full');
  });

  it('gives only the readability pass severity guidance', async () => {
    const ask = mocks();
    const { reviewEdition } = await import('@/lib/digital/review');
    await reviewEdition('py', 'loop');
    const has = (pass: string) => (ask.mock.calls.find((c) => c[0] === pass)![1] as string).includes('Severity: major only when a learner skimming the page would misread it');
    expect(has('readability')).toBe(true);
    expect(has('facts')).toBe(false);
    expect(has('pedagogy')).toBe(false);
  });

  it('currentReview is null when there is no review', async () => {
    const { currentReview } = await import('@/lib/digital/review');
    expect(await currentReview('py', 'loop')).toBeNull();
  });
});
