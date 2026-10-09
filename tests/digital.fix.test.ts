import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const sec = (title: string, role: 'intro' | 'outline' | 'quiz', outlineIndex?: number, tag = 'v1') => ({
  title, role, ...(outlineIndex !== undefined ? { outlineIndex } : {}),
  pages: [{ title: `${title} page`, blocks: [{ type: 'paragraph', text: `${title} ${tag}` }] }],
});
const edition = () => ({
  schema: 1 as const, subject: 'py', chapter: 'loop', inputsHash: 'h', generatedAt: '2026-10-09T00:00:00.000Z',
  sections: [sec('Intro', 'intro'), sec('Alpha', 'outline', 0), sec('Beta', 'outline', 1), sec('Quiz', 'quiz')],
});
const finding = (page: number, severity: 'blocker' | 'major' | 'minor' = 'major', rule = 'facts.ai') => ({ pass: 'facts', rule, severity, page, summary: `bad on ${page}`, evidence: 'ev', fix: 'do x' });
const verdictOf = (fs: ReturnType<typeof finding>[]) => (fs.some((f) => f.severity !== 'minor') ? 'fail' : 'pass') as 'fail' | 'pass';

function mocks(reviews: ReturnType<typeof finding>[][]) {
  let i = 0;
  const reviewEdition = vi.fn().mockImplementation(async () => {
    const findings = reviews[Math.min(i++, reviews.length - 1)];
    return { editionHash: 'x', generatedAt: 'now', findings, verdict: verdictOf(findings) };
  });
  const generateSection = vi.fn().mockImplementation(async (_s: string, _c: string, req: { role: 'intro' | 'outline' | 'quiz'; outlineIndex?: number }) => {
    const title = req.role === 'intro' ? 'Intro' : req.role === 'quiz' ? 'Quiz' : req.outlineIndex === 0 ? 'Alpha' : 'Beta';
    return sec(title, req.role, req.outlineIndex, 'v2');
  });
  vi.doMock('@/lib/digital/review', async (orig) => ({ ...(await orig<object>()), reviewEdition }));
  vi.doMock('@/lib/digital/generate', async (orig) => ({ ...(await orig<object>()), generateSection }));
  return { reviewEdition, generateSection };
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/digital/review'); vi.doUnmock('@/lib/digital/generate');
  root = mkdtempSync(path.join(tmpdir(), 'fix-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/loop/chapter.json', { title: 'Loop', order: 0 });
  put('handbooks/py/loop/digital/edition.json', edition());
});

describe('reviewAndFix', () => {
  it('regenerates only the section with the finding, with its notes, then passes', async () => {
    const m = mocks([[finding(3)], []]);
    const { reviewAndFix } = await import('@/lib/digital/fix');
    const steps: string[] = [];
    const r = await reviewAndFix('py', 'loop', { onStep: (s) => steps.push(s) });
    expect(r.verdict).toBe('pass');
    expect(m.generateSection).toHaveBeenCalledTimes(1);
    expect(m.generateSection.mock.calls[0][2]).toMatchObject({ role: 'outline', outlineIndex: 1 });
    expect(m.generateSection.mock.calls[0][2].notes[0]).toContain('bad on 3');
    expect(steps).toEqual(['review', 'fix:Beta', 'review']);
    const { loadEdition } = await import('@/lib/digital/edition');
    const e = (await loadEdition('py', 'loop'))!;
    expect(JSON.stringify(e.sections[2])).toContain('v2');
    expect(JSON.stringify(e.sections[1])).toContain('v1');
  });

  it('does not regenerate a section fixed in round 1 again in round 2', async () => {
    const m = mocks([[finding(2), finding(3)], [finding(2), finding(3)], []]);
    const { reviewAndFix } = await import('@/lib/digital/fix');
    const r = await reviewAndFix('py', 'loop');
    // round 1 fixes Alpha and Beta; round 2 has nothing left to fix, so the loop stops
    expect(m.generateSection).toHaveBeenCalledTimes(2);
    expect(r.verdict).toBe('fail');
  });

  it('fixes a different section in round 2 and returns the last review after the rounds', async () => {
    const m = mocks([[finding(2)], [finding(2), finding(4)], [finding(4)]]);
    const { reviewAndFix } = await import('@/lib/digital/fix');
    const r = await reviewAndFix('py', 'loop');
    expect(m.generateSection.mock.calls.map((c) => (c[2].role === 'quiz' ? 'quiz' : c[2].outlineIndex))).toEqual([0, 'quiz']);
    expect(m.reviewEdition).toHaveBeenCalledTimes(3);
    expect(r.findings).toEqual([finding(4)]);
  });

  it('sends whole-chapter findings to every outline section in round 1 only', async () => {
    const m = mocks([[finding(0)], [finding(0)]]);
    const { reviewAndFix } = await import('@/lib/digital/fix');
    await reviewAndFix('py', 'loop');
    expect(m.generateSection.mock.calls.map((c) => c[2].outlineIndex)).toEqual([0, 1]);
  });

  it('does not regenerate for minor findings or an unavailable pass', async () => {
    const m = mocks([[finding(2, 'minor'), finding(0, 'minor', 'facts.unavailable')]]);
    const { reviewAndFix } = await import('@/lib/digital/fix');
    const r = await reviewAndFix('py', 'loop');
    expect(m.generateSection).not.toHaveBeenCalled();
    expect(r.verdict).toBe('pass');
  });
});
