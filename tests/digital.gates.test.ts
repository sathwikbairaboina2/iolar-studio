import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edition } from '@/lib/digital/edition';

type Sample = { slug: string; parts: { n: number; title: string; pages: { title: string; blocks: unknown[] }[] }[] };
const sample: Sample = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/digital-sample-edition.json'), 'utf8'));

function asEdition(parts: Sample['parts'], intro = true): Edition {
  const first = intro ? 1 : 0;
  return {
    schema: 1, subject: 'python-asyncio', chapter: sample.slug, inputsHash: 'h', generatedAt: '2026-10-09T00:00:00.000Z',
    sections: parts.map((p, i) => ({
      title: p.title,
      role: intro && i === 0 ? 'intro' : i === parts.length - 1 ? 'quiz' : 'outline',
      ...(i >= first && i < parts.length - 1 ? { outlineIndex: i - first } : {}),
      pages: p.pages,
    })),
  };
}
const book = (points: string[][]) => ({ title: 't', summary: 's', chapters: points.map((p, i) => ({ title: `S${i}`, points: p })) });
const sampleBook = () => book([
  ['Concurrency is not parallelism', 'Threads, processes or asyncio'],
  ['Calling a coroutine function returns a coroutine object', '`await` suspends the current coroutine'],
  ['One turn of the event loop'],
]);

const run = vi.fn();
beforeEach(() => {
  vi.resetModules();
  run.mockReset();
  vi.doMock('@/lib/verify/sandbox', async (orig) => ({ ...(await orig<object>()), runPythonWithPrelude: run }));
});

const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', timedOut: false });
const para = (text: string) => ({ type: 'paragraph', text });
const mini = (blocks: unknown[], points: string[] = []) => ({
  edition: asEdition([
    { n: 1, title: 'Intro', pages: [{ title: 'i', blocks: [para('hello')] }] },
    { n: 2, title: 'Main', pages: [{ title: 'm', blocks }] },
    { n: 3, title: 'Quiz', pages: [{ title: 'q', blocks: [{ type: 'qa', q: 'Q?', a_bullets: ['A'] }] }] },
  ]),
  book: book([points]),
});
const py = (...l: string[]) => ({ type: 'code', lang: 'python', lines: l });
const output = (...l: string[]) => ({ type: 'code', lang: 'output', lines: l });

describe('editionGates', () => {
  it('lets the approved sample through with no blocker or major finding', async () => {
    run.mockResolvedValue(ok('fetching…\ncoroutine data\n'));
    const { editionGates } = await import('@/lib/digital/gates');
    const findings = await editionGates(asEdition(sample.parts, false), sampleBook());
    expect(findings.filter((f) => f.severity !== 'minor')).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blocks a worked example whose output differs from what it prints', async () => {
    run.mockResolvedValue(ok('2\n'));
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('x'), py('print(1)'), output('1')]);
    const f = await editionGates(m.edition, m.book);
    expect(f).toContainEqual(expect.objectContaining({ rule: 'rules.code', severity: 'blocker', page: 2 }));
    expect(f.find((x) => x.rule === 'rules.code')!.evidence).toMatch(/expected: 1 .* actual: 2/);
  });

  it('blocks a worked example that fails to run, and only warns for one without output', async () => {
    run.mockResolvedValue({ ok: false, stdout: '', stderr: 'NameError: x', timedOut: false });
    const { editionGates } = await import('@/lib/digital/gates');
    const a = mini([py('print(x)'), output('1')]);
    expect((await editionGates(a.edition, a.book)).find((f) => f.rule === 'rules.code')?.severity).toBe('blocker');
    const b = mini([py('print(x)')]);
    expect((await editionGates(b.edition, b.book)).find((f) => f.rule === 'rules.code-runs')?.severity).toBe('major');
  });

  it('replays earlier examples as the prelude of a later one', async () => {
    // Alone, the second example does not know `total`; with the first one replayed first it runs.
    run.mockImplementation(async (prelude: string, code: string) => (prelude || code !== 'print(total)' ? ok('3\n') : { ok: false, stdout: '', stderr: "NameError: name 'total' is not defined", timedOut: false }));
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([py('total = 1 + 2'), py('print(total)'), output('3')]);
    const f = await editionGates(m.edition, m.book);
    expect(f.filter((x) => x.rule.startsWith('rules.code'))).toEqual([]);
    const withPrelude = run.mock.calls.find((c) => c[0] !== '')!;
    expect(withPrelude[0]).toContain(Buffer.from('total = 1 + 2').toString('base64'));
    expect(withPrelude[1]).toBe('print(total)');
    expect(run.mock.calls[0][0]).toBe('');
  });

  it('does not replay earlier examples for one that runs on its own', async () => {
    run.mockResolvedValue(ok('1\n'));
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([py('print(1)'), output('1'), py('print(1)'), output('1')]);
    await editionGates(m.edition, m.book);
    expect(run.mock.calls.map((c) => c[0])).toEqual(['', '']);
  });

  it('skips the code checks when python is not available', async () => {
    run.mockResolvedValue({ ok: false, stdout: '', stderr: 'python not available', timedOut: false });
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([py('print(1)'), output('1')]);
    expect((await editionGates(m.edition, m.book)).filter((f) => f.rule.startsWith('rules.code'))).toEqual([]);
  });

  it('flags a paragraph over 160 characters, or more than one paragraph on a page, as major prose', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const long = mini([para('word '.repeat(40))]);
    const f = (await editionGates(long.edition, long.book)).filter((x) => x.rule === 'rules.prose');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'major', page: 2, pass: 'rules' });
    const two = mini([para('one'), para('two')]);
    expect((await editionGates(two.edition, two.book)).filter((x) => x.rule === 'rules.prose')).toHaveLength(1);
    const ok = mini([para('a short note'), { type: 'bullets', items: ['x'] }]);
    expect((await editionGates(ok.edition, ok.book)).filter((x) => x.rule === 'rules.prose')).toEqual([]);
  });

  it('reports an outline point whose key terms are missing', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('Only about apples.')], ['Explain the `Semaphore` class']);
    const f = await editionGates(m.edition, m.book);
    expect(f).toContainEqual(expect.objectContaining({ rule: 'rules.coverage', severity: 'minor', page: 2, evidence: 'Explain the `Semaphore` class' }));
  });

  it('picks the two longest words when a point has no backticked term', async () => {
    const { keyTerms } = await import('@/lib/digital/gates');
    expect(keyTerms('Threads versus coroutines in scheduling')).toEqual(['coroutines', 'scheduling']);
    expect(keyTerms('Use `await` and `asyncio.run`')).toEqual(['await', 'asyncio.run']);
    expect(keyTerms("Example: `async def fetch(): await asyncio.sleep(1); return 'data'`")).toEqual(['asyncio.sleep']);
  });

  it('counts a point as covered when half its terms appear, matching word stems', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('Libraries and the scheduling of coroutines matter.')], ['Threads versus coroutine library scheduling']);
    expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.coverage')).toEqual([]);
    const none = mini([para('Nothing relevant.')], ['Threads versus coroutine library scheduling']);
    expect((await editionGates(none.edition, none.book)).filter((x) => x.rule === 'rules.coverage')).toHaveLength(1);
  });

  it('flags single-asterisk italics, markdown headings and links as minor', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('this is *slanted* text'), para('# Heading'), para('[a link](http://x.y)'), para('fine **bold** and `*args`')]);
    const f = (await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.markdown');
    expect(f).toHaveLength(3);
    expect(f.every((x) => x.severity === 'minor')).toBe(true);
  });

  it('flags Python dunder names outside code, because the reader draws them as underlines', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('`@dataclass` writes ==__init__== for you'), para('Forgot super().__repr__()'), para('if __name__ is set')]);
    const f = (await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.dunder');
    expect(f).toHaveLength(3);
    expect(f.every((x) => x.severity === 'major')).toBe(true);
  });

  it('leaves dunder names in code and real underlines alone', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('Define `__init__` and `super().__repr__()`'), para('The list must be __sorted__ first'), para('`?` is __not__ nullable')]);
    expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.dunder')).toEqual([]);
  });

  it('flags a compare diagram and a cover page as kinds the reader does not draw', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([{ type: 'diagram', kind: 'compare', spec: { left: { title: 'a', items: ['x'] }, right: { title: 'b', items: ['y'] } } }, { type: 'labelrows', rows: [{ icon: 'python', label: 'l', text: 't' }] }]);
    const f = await editionGates(m.edition, m.book);
    expect(f.filter((x) => x.rule === 'rules.kind').map((x) => x.severity)).toEqual(['major', 'major']);
  });

  it('flags an icon with no artwork', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('look {icon:definitely-not-an-icon-zzz}')]);
    expect(await editionGates(m.edition, m.book)).toContainEqual(expect.objectContaining({ rule: 'rules.icon', severity: 'major' }));
  });

  it('reports contract errors as a blocker', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([{ type: 'table', headers: [], rows: [] }]);
    expect(await editionGates(m.edition, m.book)).toContainEqual(expect.objectContaining({ rule: 'rules.contract', severity: 'blocker' }));
  });

  it('does not fail an example without output that imports a third-party library, and marks one that claims an output as unverified', async () => {
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "ModuleNotFoundError: No module named 'uvloop'", timedOut: false });
    const { editionGates } = await import('@/lib/digital/gates');
    const a = mini([py('import uvloop')]);
    expect((await editionGates(a.edition, a.book)).filter((x) => x.rule.startsWith('rules.code'))).toEqual([]);
    // The sandbox runs without site-packages, so a pandas worked example can never run here; it is left for a person to check.
    const b = mini([py('import uvloop'), output('x')]);
    const f = (await editionGates(b.edition, b.book)).filter((x) => x.rule.startsWith('rules.code'));
    expect(f).toEqual([expect.objectContaining({ rule: 'rules.code-unverified', severity: 'minor', evidence: expect.stringContaining("No module named 'uvloop'") })]);
  });

  it('still blocks a worked example whose output fails for a stdlib reason', async () => {
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "ModuleNotFoundError: No module named 'json'", timedOut: false });
    const { editionGates } = await import('@/lib/digital/gates');
    const b = mini([py('import json'), output('x')]);
    expect((await editionGates(b.edition, b.book)).find((x) => x.rule === 'rules.code')?.severity).toBe('blocker');
  });

  it('treats a call-site fragment without output as a fragment, but not a forgotten stdlib import', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "NameError: name 'shap' is not defined", timedOut: false });
    const a = mini([py('explainer = shap.TreeExplainer(model)')]);
    expect((await editionGates(a.edition, a.book)).filter((x) => x.rule.startsWith('rules.code'))).toEqual([]);
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "NameError: name 'json' is not defined", timedOut: false });
    const b = mini([py('json.dumps({})')]);
    expect((await editionGates(b.edition, b.book)).filter((x) => x.rule === 'rules.code-runs')).toHaveLength(1);
  });

  it('reports an import error that is not a missing third-party module', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const bad = [
      "ModuleNotFoundError: No module named 'asyncio.nothing'",
      "ModuleNotFoundError: No module named 'json'",
      "ImportError: cannot import name 'gather' from 'asyncio'",
    ];
    for (const stderr of bad) {
      run.mockResolvedValue({ ok: false, stdout: '', stderr, timedOut: false });
      const m = mini([py('import uvloop')]);
      expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.code-runs'), stderr).toHaveLength(1);
    }
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "ModuleNotFoundError: No module named 'aiohttp.client'", timedOut: false });
    const ok = mini([py('import aiohttp.client')]);
    expect((await editionGates(ok.edition, ok.book)).filter((x) => x.rule.startsWith('rules.code'))).toEqual([]);
  });

  it('posixOnly exempts POSIX-only failures on Windows only', async () => {
    const { posixOnly } = await import('@/lib/digital/gates');
    const yes = [
      "AttributeError: module 'os' has no attribute 'fork'",
      "AttributeError: module 'signal' has no attribute 'SIGKILL'",
      "ModuleNotFoundError: No module named 'fcntl'",
      "ModuleNotFoundError: No module named 'resource'",
      "PermissionError: [Errno 13] Permission denied: '.'",
      "PermissionError: [Errno 13] Permission denied: '..'",
      "PermissionError: [Errno 13] Permission denied: 'data/'",
      "PermissionError: [Errno 13] Permission denied: 'data\\'",
    ];
    for (const s of yes) {
      expect(posixOnly(s, 'win32'), s).toBe(true);
      expect(posixOnly(s, 'linux'), s).toBe(false);
    }
    for (const s of ["NameError: name 'x' is not defined", "PermissionError: [Errno 13] Permission denied: 'notes.txt'", "ModuleNotFoundError: No module named 'uvloop'", "AttributeError: module 'json' has no attribute 'x'"]) expect(posixOnly(s, 'win32'), s).toBe(false);
  });

  it('reports a POSIX-only failure as one minor unverified finding, with or without an output block', async () => {
    run.mockResolvedValue({ ok: false, stdout: '', stderr: "Traceback\nPermissionError: [Errno 13] Permission denied: '.'", timedOut: false });
    const { editionGates, posixOnly } = await import('@/lib/digital/gates');
    if (!posixOnly("PermissionError: [Errno 13] Permission denied: '.'")) return; // only meaningful on Windows
    for (const blocks of [[py("os.open('.', os.O_RDONLY)")], [py("os.open('.', os.O_RDONLY)"), output('x')]]) {
      const m = mini(blocks);
      const f = (await editionGates(m.edition, m.book)).filter((x) => x.rule.startsWith('rules.code'));
      expect(f).toEqual([expect.objectContaining({ rule: 'rules.code-unverified', severity: 'minor', evidence: expect.stringContaining('Permission denied') })]);
    }
  });

  it('compares an output block exactly, ignoring line endings, trailing spaces and trailing blank lines', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const codeFindings = async (printed: string, shown: string[]) => {
      run.mockResolvedValue(ok(printed));
      const m = mini([py('print(1)'), output(...shown)]);
      return (await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.code');
    };
    expect(await codeFindings('a\r\nb  \r\n\r\n', ['a', 'b'])).toEqual([]);
    expect(await codeFindings('a\nb\nc\n', ['a', 'b'])).toHaveLength(1);
    expect(await codeFindings('a\nb\n', ['b'])).toHaveLength(1);
    expect(await codeFindings('[1, 2]\n', ['[1,2]'])).toHaveLength(1);
  });

  it('stops running examples when the time budget is spent and says so with a major finding', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    run.mockResolvedValue(ok('1\n'));
    const m = mini([py('print(1)'), output('1'), py('print(2)'), output('2')]);
    const findings = await editionGates(m.edition, m.book, { budgetMs: 0 });
    expect(run).not.toHaveBeenCalled();
    const budget = findings.filter((x) => x.rule === 'rules.budget');
    expect(budget).toHaveLength(1);
    expect(budget[0].severity).toBe('major');
    const { chapterVerdict } = await import('@/lib/publish/verdict');
    expect(chapterVerdict([findings], [])).toBe('unsure');
    run.mockClear();
    expect((await editionGates(m.edition, m.book)).some((x) => x.rule === 'rules.budget')).toBe(false);
    expect(run).toHaveBeenCalled();
  });

  it('finds a dotted name through its member', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('Advance it with send(None) until it stops.')], ['Use `coro.send(None)` to advance it']);
    expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.coverage')).toEqual([]);
  });

  it('finds a term written in another form of the same word', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    const m = mini([para('Resolve it: delete every marker line.')], ['Resolution means deleting all three marker lines']);
    expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.coverage')).toEqual([]);
  });

  it('finds a dunder term inside code kept verbatim', async () => {
    const { editionGates } = await import('@/lib/digital/gates');
    run.mockResolvedValue(ok(''));
    const m = mini([para('Setup.'), py('def __init__(self):', '    pass')], ['Explain `__init__`']);
    expect((await editionGates(m.edition, m.book)).filter((x) => x.rule === 'rules.coverage')).toEqual([]);
  });

  it('keyTerms ignores generic question words and falls back to all-caps acronyms', async () => {
    const { keyTerms } = await import('@/lib/digital/gates');
    const jdk = keyTerms('What is the difference between JDK, JRE and JVM?');
    expect(jdk.length).toBeGreaterThan(0);
    for (const t of jdk) expect(['jdk', 'jre', 'jvm']).toContain(t);
    const heap = keyTerms('What is the difference between heap and stack memory?');
    expect(heap.length).toBeGreaterThan(0);
    for (const t of heap) expect(['difference', 'between']).not.toContain(t);
    expect(heap).toContain('memory');
    const generic = keyTerms('Give an example of choosing instead of containing');
    for (const t of generic) expect(['example', 'choosing', 'instead', 'containing']).not.toContain(t);
    expect(keyTerms('Explain the `Semaphore` class')).toEqual(['Semaphore']);
  });
});

describe('keyTerms generic words', () => {
  it('keeps importing and other import words', async () => {
    const { keyTerms } = await import('@/lib/digital/gates');
    expect(keyTerms('Why importing modules matters')).toContain('importing');
  });
});
