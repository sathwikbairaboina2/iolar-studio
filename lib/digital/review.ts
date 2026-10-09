import { promises as fs } from 'fs';
import path from 'path';
import { loadBook } from '@/lib/ai/book';
import { digitalDir } from '@/lib/paths';
import { stripInline } from '@/lib/renderer/inline';
import { SHAPE, askClaude } from '@/lib/verify/review';
import type { Finding } from '@/lib/verify/gates';
import { chapterVerdict } from '@/lib/publish/verdict';
import type { Verdict } from '@/lib/publish/state';
import { editionHash, loadEdition, type Edition } from './edition';
import { editionGates } from './gates';

/** Bump when the gates or the review prompts change in a way that makes an older review out of date. */
export const GATES_VERSION = 2;

export type EditionReview = { editionHash: string; generatedAt: string; gatesVersion?: number; findings: Finding[]; verdict: Verdict };

export function reviewFile(s: string, c: string) {
  return path.join(digitalDir(s, c), 'review.json');
}

const SKIP = new Set(['type', 'kind', 'style', 'ink', 'icon', 'frame', 'shape']);
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(stripInline(v));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP.has(k)) strings(x, out);
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

/** Rule checks first (cheap, no AI), then the facts, pedagogy and readability passes side by side. */
export async function reviewEdition(subject: string, chapter: string, opts: { onStep?: (step: string) => void } = {}): Promise<EditionReview> {
  const edition = await loadEdition(subject, chapter);
  if (!edition) throw new Error('there is no edition to review');
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('the chapter has no book.json to review against');

  opts.onStep?.('rules');
  const gates = await editionGates(edition, book);
  const text = editionText(edition);

  opts.onStep?.('ai');
  const [facts, pedagogy, readability] = await Promise.all([
    askClaude('facts', [
      'You are fact-checking a technical chapter written for the web before publication.',
      'Extract every factual claim (complexities, API names and signatures, version behaviour, semantics, and the printed output of examples) and verify it.',
      'Report ONLY claims that are wrong or misleading. Correct-but-terse is fine; do not report style.',
      'Use web search when a claim depends on current library or language behaviour. Page numbers below are the ones to use in "page".',
      WRONG_ANSWER,
      'Chapter text:', text, SHAPE,
    ].join('\n\n'), ['WebSearch', 'WebFetch']),

    askClaude('pedagogy', [
      'You are reviewing whether a web chapter teaches what its outline promises.',
      'Report only: an outline point that is missing or only named, a term used before it is defined, sections in an order that would confuse a learner, an example that does not teach its point, or a quiz question that tests wording instead of understanding or whose answer is wrong.',
      'Do not report wording style or density.',
      WRONG_ANSWER,
      `The outline this was written from:\n${JSON.stringify(book.chapters.map((c) => ({ title: c.title, points: c.points })))}`,
      'Chapter text:', text, SHAPE,
    ].join('\n\n')),

    askClaude('readability', [
      'You are reviewing how a chapter reads as a web page.',
      'Report only: phrasing that only makes sense on slides (swipe, next slide, page numbers), code shown before the idea behind it is explained, paragraphs that are really bullet dumps, or terms used inconsistently for the same thing.',
      'Do not report taste or small wording choices.',
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
