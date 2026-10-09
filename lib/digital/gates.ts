import type { Book } from '@/lib/ai/book';
import { stripInline } from '@/lib/renderer/inline';
import { iconSvg } from '@/lib/renderer/icons';
import { buildPrelude, outputMatches, runPythonWithPrelude } from '@/lib/verify/sandbox';
import type { Finding } from '@/lib/verify/gates';
import { PY_STDLIB } from './stdlib';
import { validateEdition, type Edition } from './edition';

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

/**
 * The key terms of an outline point: the longest identifier of each backticked span, else the two longest
 * words of six letters or more. A point is covered when at least half of its terms show up (see `covered`).
 */
export function keyTerms(point: string): string[] {
  const spans = [...point.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (spans.length) {
    const terms = spans.map((span) => (span.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []).sort((x, y) => y.length - x.length)[0]).filter((x): x is string => !!x);
    return [...new Set(terms)];
  }
  const words = [...new Set(point.toLowerCase().match(/[a-z][a-z0-9_]{5,}/g) ?? [])];
  return words.sort((a, b) => b.length - a.length).slice(0, 2);
}

/** A plain word matches by its first six letters, so "switched" is found as "switches" and "library" as "libraries". */
function seen(body: string, term: string): boolean {
  const t = term.toLowerCase();
  if (body.includes(/^[a-z]+$/.test(t) && t.length > 6 ? t.slice(0, 6) : t)) return true;
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
  return !!m && !PY_STDLIB.has(m[1].split('.')[0]);
}

export async function editionGates(e: Edition, book: Book): Promise<Finding[]> {
  const out: Finding[] = [];
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
    if (!pythonMissing) {
      // Standalone first: most examples are whole programs, and replaying every earlier example makes slow ones slower.
      // Only an example that fails alone is tried again with the earlier ones as its prelude.
      const text = code.join('\n');
      const expected = hasOutput ? lines(next!).join('\n') : null;
      const good = (r: Awaited<ReturnType<typeof runPythonWithPrelude>>) => r.ok && !r.timedOut && (expected === null || outputMatches(r.stdout, expected));
      let res = await runPythonWithPrelude('', text);
      if (/python not available/.test(res.stderr)) pythonMissing = true;
      else {
        if (!good(res) && earlier.length) {
          const withPrelude = await runPythonWithPrelude(buildPrelude(earlier), text, { timeoutMs: Math.min(60_000, 5_000 + 1_500 * earlier.length) });
          // Keep the prelude run when it succeeds, or when the standalone run did not even run (its error then names the real problem).
          if (good(withPrelude) || !res.ok) res = withPrelude;
        }
        // A fragment that shows a third-party library (uvloop, aiohttp) cannot run here; only one that claims an output must.
        const thirdParty = !hasOutput && !res.ok && missingThirdParty(res.stderr);
        if (thirdParty) {
          // nothing to report
        } else if (!res.ok || res.timedOut) {
          const why = res.timedOut ? 'timed out' : res.stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200);
          out.push(hasOutput
            ? finding('rules.code', 'blocker', page, 'A worked example fails when run, so the output shown cannot be right.', why, 'Fix the code so it runs and prints the output shown.')
            : finding('rules.code-runs', 'major', page, 'A code example fails when run.', why, 'Fix the code, or mark it as a fragment by showing only the call site.'));
        } else if (expected !== null && !outputMatches(res.stdout, expected)) {
          out.push(finding('rules.code', 'blocker', page, 'A worked example prints something other than the output shown.', `expected: ${firstLines(expected)} / actual: ${firstLines(res.stdout)}`, 'Make the output block hold exactly what the code prints.'));
        }
      }
    }
    earlier.push(code);
  }

  // Every outline point has to show up in its section.
  e.sections.forEach((s, si) => {
    if (s.role !== 'outline') return;
    const point = pages.findIndex((p) => p.section === si) + 1;
    const body = s.pages.flatMap((p) => [p.title, ...texts(p.blocks), ...(p.blocks as Record<string, unknown>[]).filter((b) => b.type === 'code').flatMap(lines)]).map(stripInline).join('\n').toLowerCase();
    for (const pt of book.chapters[s.outlineIndex ?? -1]?.points ?? []) {
      const terms = keyTerms(pt);
      const missing = terms.filter((t) => !seen(body, t));
      if (terms.length && terms.length - missing.length < Math.ceil(terms.length / 2)) out.push(finding('rules.coverage', 'major', point, `The section does not cover an outline point (missing ${missing.map((m) => `"${m}"`).join(', ')}).`, pt, 'Add the point with an explanation and an example.'));
    }
  });

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
