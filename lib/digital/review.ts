import { promises as fs } from 'fs';
import path from 'path';
import { loadBook } from '@/lib/ai/book';
import { categoryOf } from '@/lib/handbookCategories';
import { digitalDir } from '@/lib/paths';
import { stripInline } from '@/lib/renderer/inline';
import { SHAPE, askClaude } from '@/lib/verify/review';
import type { Finding } from '@/lib/verify/gates';
import { chapterCategory } from '@/lib/store';
import { chapterVerdict } from '@/lib/publish/verdict';
import type { Verdict } from '@/lib/publish/state';
import { editionHash, loadEdition, type Edition } from './edition';
import { editionGates } from './gates';

/** Bump when the gates or the review prompts change in a way that makes an older review out of date. */
export const GATES_VERSION = 5;

export type EditionReview = { editionHash: string; generatedAt: string; gatesVersion?: number; findings: Finding[]; verdict: Verdict };

export function reviewFile(s: string, c: string) {
  return path.join(digitalDir(s, c), 'review.json');
}

const SKIP = new Set(['type', 'kind', 'style', 'ink', 'icon', 'frame', 'shape']);
/** Code is read as written: stripInline would turn `2**32` into `232`, `a == b` into `a b` and `__init__` into `init`. */
const VERBATIM = new Set(['lines', 'example_code']);
/** A flowchart as its title, one line per edge and any node no edge touches; its ids and rows mean nothing to a reader. */
function flowchartLines(spec: Record<string, unknown>): string[] {
  const nodes = (spec.nodes && typeof spec.nodes === 'object' ? spec.nodes : {}) as Record<string, { text?: unknown }>;
  const name = (id: unknown) => stripInline(String(nodes[String(id)]?.text ?? id));
  const edges = (Array.isArray(spec.edges) ? spec.edges : []) as { from?: unknown; to?: unknown; label?: unknown }[];
  const lines = typeof spec.title === 'string' ? [stripInline(spec.title)] : [];
  for (const e of edges) lines.push(`${name(e.from)} --${e.label ? `${stripInline(String(e.label))}--` : ''}> ${name(e.to)}`);
  const used = new Set(edges.flatMap((e) => [String(e.from), String(e.to)]));
  for (const id of Object.keys(nodes)) if (!used.has(id)) lines.push(name(id));
  return lines;
}

function strings(v: unknown, out: string[] = [], raw = false): string[] {
  const block = v as { type?: unknown; kind?: unknown; spec?: unknown } | null;
  if (block && typeof block === 'object' && block.type === 'diagram' && block.kind === 'flowchart' && block.spec && typeof block.spec === 'object') {
    out.push(...flowchartLines(block.spec as Record<string, unknown>));
  } else if (block && typeof block === 'object' && block.type === 'table') {
    // One line per row: cells written one per line read as a garbled table.
    const t = block as { headers?: unknown; rows?: unknown };
    const row = (r: unknown) => (Array.isArray(r) ? r.map((c) => stripInline(String(c ?? ''))).join(' | ') : '');
    out.push(...[t.headers, ...(Array.isArray(t.rows) ? t.rows : [])].filter(Array.isArray).map(row));
  } else if (typeof v === 'string') out.push(raw ? v : stripInline(v));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, raw));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP.has(k)) strings(x, out, VERBATIM.has(k));
  return out;
}

/** The edition as plain text by page, with the page numbers findings refer to. */
export function editionText(e: Edition): string {
  let n = 0;
  return e.sections
    .map((s) => `## ${s.title}\n${s.pages.map((p) => `### Page ${++n}: ${p.title}\n${strings(p.blocks).join('\n')}`).join('\n\n')}`)
    .join('\n\n');
}

export async function loadEditionReview(s: string, c: string): Promise<EditionReview | null> {
  try {
    return JSON.parse(await fs.readFile(reviewFile(s, c), 'utf8')) as EditionReview;
  } catch {
    return null;
  }
}

/** The saved review, but only while it judged the edition that is on disk now. */
export async function currentReview(s: string, c: string): Promise<EditionReview | null> {
  const [review, edition] = await Promise.all([loadEditionReview(s, c), loadEdition(s, c)]);
  return review && edition && review.editionHash === editionHash(edition) && review.gatesVersion === GATES_VERSION ? review : null;
}

const WRONG_ANSWER = 'A wrong quiz answer or wrong example output is severity "major", never "minor": a learner would be taught something false.';
const WRONG_ANSWER_TEXT = /\b(wrong|incorrect|incorrectly|false)\b[^.]{0,60}\b(answer|output)\b|\b(answer|output)\b[^.]{0,60}\b(is|are)\s+(wrong|incorrect|false)\b/i;

/** The reviewers sometimes call a wrong answer minor; it never is. */
export function raiseWrongAnswers(findings: Finding[]): Finding[] {
  return findings.map((f) => (f.severity === 'minor' && !f.rule.endsWith('.unavailable') && WRONG_ANSWER_TEXT.test(f.summary) ? { ...f, severity: 'major' as const } : f));
}

/** What a page of these categories is meant to look like, so the reviewers do not report it as a defect. */
const INTENDED_SHAPE: Partial<Record<string, string>> = {
  'interview-qa': 'Pages written as numbered qa blocks without headings are the intended shape for this category.',
  drills: 'Numbered task headings each followed by solution code and its result are the intended shape.',
};

/** Rule checks first (cheap, no AI), then the facts, pedagogy and readability passes side by side. */
export async function reviewEdition(subject: string, chapter: string, opts: { onStep?: (step: string) => void } = {}): Promise<EditionReview> {
  const edition = await loadEdition(subject, chapter);
  if (!edition) throw new Error('there is no edition to review');
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('the chapter has no book.json to review against');

  opts.onStep?.('rules');
  const gates = await editionGates(edition, book);
  const text = editionText(edition);
  const category = categoryOf(await chapterCategory(subject, chapter).catch(() => undefined));
  const categoryLine = `The chapter's category is ${category.name}: ${category.blurb}`;
  const shapeLine = INTENDED_SHAPE[category.id];

  opts.onStep?.('ai');
  const [facts, pedagogy, readability] = await Promise.all([
    askClaude('facts', [
      'You are fact-checking a technical chapter written for the web before publication.',
      'Extract every factual claim (complexities, API names and signatures, version behaviour, semantics, and the printed output of examples) and verify it.',
      'Report ONLY claims that are wrong or misleading. Correct-but-terse is fine; do not report style.',
      'Use web search when a claim depends on current library or language behaviour. Page numbers below are the ones to use in "page".',
      WRONG_ANSWER, categoryLine,
      'Chapter text:', text, SHAPE,
    ].join('\n\n'), ['WebSearch', 'WebFetch']),

    askClaude('pedagogy', [
      'You are reviewing whether a web chapter teaches what its outline promises.',
      'Report only: an outline point that is missing or only named, a term used before it is defined, sections in an order that would confuse a learner, an example that does not teach its point, or a quiz question that tests wording instead of understanding or whose answer is wrong.',
      'Do not report wording style or density.',
      WRONG_ANSWER, categoryLine, ...(shapeLine ? [shapeLine] : []),
      `The outline this was written from:\n${JSON.stringify(book.chapters.map((c) => ({ title: c.title, points: c.points })))}`,
      'Chapter text:', text, SHAPE,
    ].join('\n\n')),

    askClaude('readability', [
      'You are reviewing whether each page of a handbook chapter reads as scannable revision notes, the page a learner skims the night before an exam.',
      'Report only: phrasing that only makes sense on slides (swipe, next slide, page numbers), prose dumps (sentences strung together where one-line bullets, a table or a diagram would do), a bullet that holds more than one idea, a process or comparison written as text where a visual would help, code shown before the idea behind it is stated, or terms used inconsistently for the same thing. Check that each page keeps one idea per bullet and uses visuals where they help.',
      'Do not report taste or small wording choices.',
      'Severity: major only when a learner skimming the page would misread it or cannot follow it: the page is mostly prose, a diagram or table cannot be followed, two pages contradict each other on a term, or a question is posed without its answer. A bullet holding two ideas, a long bullet, a missing visual, or code shown before its one-line idea is minor.',
      categoryLine, ...(shapeLine ? [shapeLine] : []),
      'Chapter text:', text, SHAPE,
    ].join('\n\n')),
  ]);
  opts.onStep?.('done');

  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const findings = raiseWrongAnswers([...gates, ...facts, ...pedagogy, ...readability]).sort((a, b) => order[a.severity] - order[b.severity] || a.page - b.page);
  const review: EditionReview = {
    editionHash: editionHash(edition),
    generatedAt: new Date().toISOString(),
    gatesVersion: GATES_VERSION,
    findings,
    verdict: chapterVerdict([findings], []),
  };
  await fs.mkdir(digitalDir(subject, chapter), { recursive: true });
  await fs.writeFile(reviewFile(subject, chapter), JSON.stringify(review, null, 2));
  return review;
}
