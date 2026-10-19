import type { Book } from '@/lib/ai/book';
import { stripInline } from '@/lib/renderer/inline';
import { iconSvg } from '@/lib/renderer/icons';
import { buildPrelude, outputEquals, runPythonWithPrelude } from '@/lib/verify/sandbox';
import type { Finding } from '@/lib/verify/gates';
import { PY_STDLIB } from './stdlib';
import { MAX_PARAGRAPHS_PER_PAGE, MAX_PARAGRAPH_CHARS, validateEdition, type Edition } from './edition';

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'bullets', 'code', 'table', 'callout', 'sidebox', 'qa', 'diagram']);
const DIAGRAM_KINDS = new Set(['flow', 'chain', 'flowchart', 'cards', 'array', 'matrix', 'tables', 'schema', 'er']);

type Located = { block: Record<string, unknown>; page: number; section: number };

const finding = (rule: string, severity: Finding['severity'], page: number, summary: string, evidence: string, fix: string): Finding =>
  ({ pass: 'rules', rule, severity, page, summary, evidence, fix });

/** Pages of the edition flattened across sections, 1-based, with each block located. */
function flatten(e: Edition) {
  const pages: { title: string; section: number; page: Record<string, unknown>; blocks: Located[] }[] = [];
  e.sections.forEach((s, si) => {
    s.pages.forEach((p) => {
      const n = pages.length + 1;
      pages.push({
        title: p.title, section: si, page: p as unknown as Record<string, unknown>,
        blocks: (p.blocks as Record<string, unknown>[]).map((block) => ({ block, page: n, section: si })),
      });
    });
  });
  return pages;
}

/** Fields whose strings are not prose. */
const NON_TEXT = new Set(['type', 'kind', 'style', 'ink', 'icon', 'lang', 'frame', 'shape']);
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'code') return out;
    for (const [k, x] of Object.entries(o)) if (!NON_TEXT.has(k)) texts(x, out);
  }
  return out;
}

function iconRefs(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') for (const m of v.matchAll(/\{icon:([^{}\n]+?)\}/g)) out.push(m[1].trim());
  else if (Array.isArray(v)) v.forEach((x) => iconRefs(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'icon' && typeof x === 'string') out.push(x.trim());
      else iconRefs(x, out);
    }
  }
  return out.filter(Boolean);
}

const lines = (b: Record<string, unknown>) => (Array.isArray(b.lines) ? (b.lines as unknown[]).map(String) : []);

/** Question and instruction words that say nothing about the topic; matched by their first six letters so inflections are covered. */
const GENERIC = new Set([
  'differ', 'between', 'example', 'explai', 'descri', 'instea', 'choose', 'choosi', 'contai', 'return', 'separa', 'compar', 'versus', 'withou',
  'whethe', 'should', 'common', 'mistak', 'unders', 'differ', 'follow', 'anothe', 'relate', 'usage', 'actual', 'really', 'always',
  'called', 'during', 'before', 'behind', 'inside', 'around',
].map((w) => w.slice(0, 6)));

/**
 * The key terms of an outline point: the longest identifier of each backticked span, else the two longest
 * words of six letters or more that are not generic question words, topped up with all-caps acronyms
 * (JDK, TLB) when fewer than two remain. A point is covered when at least half of its terms show up (see `covered`).
 */
export function keyTerms(point: string): string[] {
  const spans = [...point.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (spans.length) {
    const terms = spans.map((span) => (span.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []).sort((x, y) => y.length - x.length)[0]).filter((x): x is string => !!x);
    return [...new Set(terms)];
  }
  const words = [...new Set(point.toLowerCase().match(/[a-z][a-z0-9_]{5,}/g) ?? [])].filter((w) => !GENERIC.has(w.slice(0, 6)));
  const terms = words.sort((a, b) => b.length - a.length).slice(0, 2);
  if (terms.length < 2) {
    const acronyms = [...new Set((point.match(/(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])/g) ?? []).map((a) => a.toLowerCase()))];
    for (const a of acronyms) if (terms.length < 2 && !terms.includes(a)) terms.push(a);
  }
  return terms;
}

/** A plain word matches by its first six letters, so "switched" is found as "switches" and "library" as "libraries". */
function seen(body: string, term: string): boolean {
  const t = term.toLowerCase();
  // A five-letter stem finds other forms of the word: "deleting" in "delete", "resolution" in "resolve".
  if (body.includes(/^[a-z]+$/.test(t) && t.length > 6 ? t.slice(0, 5) : t)) return true;
  // A dotted name such as coro.send is also found by its member when the prose writes send(None).
  const last = t.includes('.') ? t.slice(t.lastIndexOf('.') + 1) : '';
  return last.length >= 4 && body.includes(last);
}

const MARKDOWN: [RegExp, string][] = [
  [/(^|[^*])\*[^*\s][^*]*\*(?!\*)/, 'single-asterisk italics'],
  [/^#{1,6}\s/m, 'a markdown heading'],
  [/\[[^\]]+\]\([^)]+\)/, 'a markdown link'],
];

/** Output the printed text of a run is compared against. */
function firstLines(s: string) {
  return s.trim().split('\n').slice(0, 3).join(' | ').slice(0, 160);
}

/** True only for "No module named 'X'" where X's top-level package is not part of the standard library. */
export function missingThirdParty(stderr: string): boolean {
  const m = stderr.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/);
  if (m) return !PY_STDLIB.has(m[1].split('.')[0]);
  // A call site such as `shap.TreeExplainer(model)` names what the page does not set up; a forgotten stdlib import is still a bug.
  const n = stderr.match(/NameError: name ['"]([^'"]+)['"] is not defined/);
  return !!n && !PY_STDLIB.has(n[1]);
}

/** True on Windows when a run failed only because the example uses something POSIX-only (os.fork, fcntl, opening a directory). */
export function posixOnly(stderr: string, platform: string = process.platform): boolean {
  if (platform !== 'win32') return false;
  if (/AttributeError: module '(os|signal|select|time)' has no attribute/.test(stderr)) return true;
  if (/ModuleNotFoundError: No module named '(fcntl|resource|pwd|grp|termios|tty|pty|posix|crypt|spwd|syslog|curses|readline)'/.test(stderr)) return true;
  const p = stderr.match(/PermissionError: \[Errno 13\] Permission denied: '([^']*)'/);
  return !!p && (p[1] === '.' || p[1] === '..' || /[/\\]$/.test(p[1]));
}

/** All the examples together may take this long to run; after that the rest are skipped and the verdict cannot be a pass. */
export const GATES_BUDGET_MS = 10 * 60_000;

export async function editionGates(e: Edition, book: Book, opts: { budgetMs?: number } = {}): Promise<Finding[]> {
  const out: Finding[] = [];
  const started = Date.now();
  const budget = opts.budgetMs ?? GATES_BUDGET_MS;
  let overBudget = false;
  const pages = flatten(e);

  const v = validateEdition(e, e.chapter);
  if (!v.ok) for (const err of v.errors.slice(0, 8)) out.push(finding('rules.contract', 'blocker', 0, 'The edition does not match the handbook file format.', err, 'Regenerate the section so every block is valid.'));

  // Block kinds the reader does not draw.
  for (const p of pages) {
    const pageKind = (p.page as { kind?: string; cover?: unknown });
    if (pageKind.kind === 'cover' || pageKind.cover) out.push(finding('rules.kind', 'major', p.blocks[0]?.page ?? 0, 'A cover page does not belong in a web edition.', p.title, 'Use a normal page with a heading and paragraphs.'));
    for (const { block, page } of p.blocks) {
      const type = String(block.type);
      if (!BLOCK_TYPES.has(type)) out.push(finding('rules.kind', 'major', page, `The block type "${type}" is not drawn by the reader.`, type, 'Use a paragraph, bullets, table, callout or diagram instead.'));
      else if (type === 'diagram' && !DIAGRAM_KINDS.has(String(block.kind))) out.push(finding('rules.kind', 'major', page, `The diagram kind "${String(block.kind)}" is not drawn by the reader.`, String(block.kind), 'Use flow, chain, flowchart, cards, array, matrix, tables, schema or er.'));
    }
  }

  // Run every python example, with the earlier examples of the edition replayed first.
  const earlier: string[][] = [];
  let pythonMissing = false;
  const sequence = pages.flatMap((p) => p.blocks);
  for (let i = 0; i < sequence.length; i++) {
    const { block, page } = sequence[i];
    if (block.type !== 'code' || !/^py(thon)?$/i.test(String(block.lang ?? 'python'))) continue;
    const code = lines(block);
    const next = sequence[i + 1]?.block;
    const hasOutput = !!next && next.type === 'code' && next.lang === 'output';
    if (!pythonMissing && !overBudget && Date.now() - started >= budget) {
      overBudget = true;
      out.push(finding('rules.budget', 'major', page, 'The examples took too long to run, so the rest were not checked.', `time budget ${Math.round(budget / 1000)}s`, 'Run the review again, or shorten the examples.'));
    }
    if (!pythonMissing && !overBudget) {
      // Standalone first: most examples are whole programs, and replaying every earlier example makes slow ones slower.
      // Only an example that fails alone is tried again with the earlier ones as its prelude.
      const text = code.join('\n');
      const expected = hasOutput ? lines(next!).join('\n') : null;
      const good = (r: Awaited<ReturnType<typeof runPythonWithPrelude>>) => r.ok && !r.timedOut && (expected === null || outputEquals(r.stdout, expected));
      let res = await runPythonWithPrelude('', text);
      if (/python not available/.test(res.stderr)) pythonMissing = true;
      else {
        if (!good(res) && earlier.length) {
          const withPrelude = await runPythonWithPrelude(buildPrelude(earlier), text, { timeoutMs: Math.min(60_000, 5_000 + 1_500 * earlier.length) });
          // Keep the prelude run when it succeeds, or when the standalone run did not even run (its error then names the real problem).
          if (good(withPrelude) || !res.ok) res = withPrelude;
        }
        // A fragment that shows a third-party library (uvloop, aiohttp) cannot run here; only one that claims an output must.
        const thirdParty = !res.ok && !res.timedOut && missingThirdParty(res.stderr);
        if (thirdParty && !hasOutput) {
          // nothing to report
        } else if (thirdParty) {
          // The sandbox runs without site-packages, so a pandas worked example cannot run here; a person checks its output.
          out.push(finding('rules.code-unverified', 'minor', page, 'A worked example uses a library that is not installed here, so its output was not checked.', res.stderr.trim().split('\n').slice(-1)[0].slice(0, 200), 'Check the output by running it with the library installed.'));
        } else if (!res.ok && !res.timedOut && posixOnly(res.stderr)) {
          out.push(finding('rules.code-unverified', 'minor', page, 'A POSIX-only example could not be run on this machine, so it was not checked.', res.stderr.trim().split('\n').slice(-1)[0].slice(0, 200), 'Check it on Linux or macOS.'));
        } else if (!res.ok || res.timedOut) {
          const why = res.timedOut ? 'timed out' : res.stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200);
          out.push(hasOutput
            ? finding('rules.code', 'blocker', page, 'A worked example fails when run, so the output shown cannot be right.', why, 'Fix the code so it runs and prints the output shown.')
            : finding('rules.code-runs', 'major', page, 'A code example fails when run.', why, 'Fix the code, or mark it as a fragment by showing only the call site.'));
        } else if (expected !== null && !outputEquals(res.stdout, expected)) {
          out.push(finding('rules.code', 'blocker', page, 'A worked example prints something other than the output shown.', `expected: ${firstLines(expected)} / actual: ${firstLines(res.stdout)}`, 'Make the output block hold exactly what the code prints.'));
        }
      }
    }
    earlier.push(code);
  }

  // Every outline point has to show up in its section. Word matching misses terse paraphrase ("dup ACKs"), so this is a
  // hint; the pedagogy pass, which reads the outline, reports a point that is really missing as major.
  e.sections.forEach((s, si) => {
    if (s.role !== 'outline') return;
    const point = pages.findIndex((p) => p.section === si) + 1;
    const body = s.pages.flatMap((p) => [...[p.title, ...texts(p.blocks)].map(stripInline), ...(p.blocks as Record<string, unknown>[]).filter((b) => b.type === 'code').flatMap(lines)]).join('\n').toLowerCase();
    for (const pt of book.chapters[s.outlineIndex ?? -1]?.points ?? []) {
      const terms = keyTerms(pt);
      const missing = terms.filter((t) => !seen(body, t));
      if (terms.length && terms.length - missing.length < Math.ceil(terms.length / 2)) out.push(finding('rules.coverage', 'minor', point, `The section does not cover an outline point (missing ${missing.map((m) => `"${m}"`).join(', ')}).`, pt, 'Add the point with an explanation and an example.'));
    }
  });

  // Revision notes, not prose: at most one short paragraph per page.
  for (const p of pages) {
    const page = p.blocks[0]?.page ?? 0;
    const paragraphs = p.blocks.filter((l) => l.block.type === 'paragraph');
    const long = paragraphs.find((l) => stripInline(String(l.block.text ?? '')).length > MAX_PARAGRAPH_CHARS);
    if (long) out.push(finding('rules.prose', 'major', page, `A paragraph is over ${MAX_PARAGRAPH_CHARS} characters; revision pages are notes, not prose.`, stripInline(String(long.block.text)).slice(0, 100), 'Cut it into one-line bullets, a table or a diagram.'));
    else if (paragraphs.length > MAX_PARAGRAPHS_PER_PAGE) out.push(finding('rules.prose', 'major', page, `The page has ${paragraphs.length} paragraphs; at most ${MAX_PARAGRAPHS_PER_PAGE} is allowed.`, p.title, 'Turn the extra paragraphs into one-line bullets.'));
  }

  // Studio inline syntax only.
  for (const p of pages) {
    for (const { block, page } of p.blocks) {
      for (const t of texts(block)) {
        const bare = t.replace(/`[^`]*`/g, '');
        for (const [re, what] of MARKDOWN) {
          if (re.test(bare)) { out.push(finding('rules.markdown', 'minor', page, `The text uses ${what}, which the reader does not draw.`, t.slice(0, 100), 'Use the studio syntax: **bold**, ==mark==, `code`, __underline__.')); break; }
        }
      }
      for (const name of iconRefs(block)) {
        if (!iconSvg(name)) out.push(finding('rules.icon', 'major', page, `The icon "${name}" has no artwork.`, name, 'Use an icon name the studio can draw, or remove it.'));
      }
    }
  }
  return out;
}
