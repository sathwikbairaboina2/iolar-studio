import { promises as fs } from 'fs';
import path from 'path';
import { listParts, loadPost } from '../store';
import { partDir, rendersDir } from '../paths';
import { loadBook } from '../ai/book';
import { runClaude } from '../ai/claude';
import { extractJson } from '../ai/revise';
import { runGates } from './runGates';
import type { Finding, Severity } from './gates';

export type Review = {
  generatedAt: string;
  part: number;
  findings: Finding[];
  passed: boolean;
};

export function reviewFile(subject: string, chapter: string, part: number) {
  return path.join(partDir(subject, chapter, part), 'review.json');
}

const SEVERITIES: Severity[] = ['blocker', 'major', 'minor'];

/**
 * A part passes when nothing blocks it and no major factual error stands. Wrong content must
 * not publish; a thin page or a teaching-order nit is worth fixing but may ship.
 */
export function reviewPassed(findings: Finding[]): boolean {
  return !findings.some((f) => f.severity === 'blocker' || (f.severity === 'major' && f.pass === 'facts'));
}

/**
 * What the chapter's other parts cover, by page title. A part judged alone reads its own
 * caption and syllabus as promises, and reports topics the next part teaches as missing.
 */
async function siblingParts(subject: string, chapter: string, part: number): Promise<string> {
  const others = (await listParts(subject, chapter)).filter((n) => n !== part);
  const lines = await Promise.all(others.map(async (n) => {
    try {
      return `- Part ${n}: ${(await loadPost(subject, chapter, n)).slides.map((s) => s.page_title).join('; ')}`;
    } catch {
      return '';
    }
  }));
  const known = lines.filter(Boolean);
  return known.length
    ? `This is part ${part} of a chapter split across parts. The other parts cover the topics below, so do not report them as missing here:\n${known.join('\n')}`
    : '';
}

const SHAPE = `Return ONLY a JSON object, no prose and no markdown fences:
{"findings":[{"severity":"blocker"|"major"|"minor","page":number,"summary":string,"evidence":string,"fix":string}]}
- "page" is 1-based; use 0 for something about the whole part.
- "summary" is ONE sentence naming the defect.
- "evidence" quotes the exact text or measurement the finding rests on.
- "fix" is a concrete change.
Report only real defects. An empty findings array is the correct answer for clean content.`;

function parseFindings(raw: string, pass: string): Finding[] {
  try {
    const parsed = extractJson(raw) as { findings?: unknown[] };
    const list = Array.isArray(parsed.findings) ? parsed.findings : [];
    return list.flatMap((f) => {
      const x = f as Partial<Finding>;
      if (!x.summary) return [];
      const severity = SEVERITIES.includes(x.severity as Severity) ? (x.severity as Severity) : 'minor';
      return [{
        pass,
        rule: `${pass}.ai`,
        severity,
        page: Number(x.page ?? 0) || 0,
        summary: String(x.summary),
        evidence: String(x.evidence ?? ''),
        fix: String(x.fix ?? ''),
      }];
    });
  } catch {
    return [];
  }
}

async function askClaude(pass: string, prompt: string, allowedTools?: string[]): Promise<Finding[]> {
  try {
    return parseFindings(await runClaude(prompt, { timeoutMs: 900_000, allowedTools }), pass);
  } catch (err) {
    // A pass that cannot run must not silently pretend the content is clean.
    return [{
      pass, rule: `${pass}.unavailable`, severity: 'minor', page: 0,
      summary: `The ${pass} review pass could not run.`,
      evidence: String(err).slice(0, 120),
      fix: 'Re-run the review once the Claude CLI is available.',
    }];
  }
}

/**
 * Reviews one finished part. Deterministic gates run first and are cheap; the Claude passes
 * run concurrently. The agent never edits — it reports, and fixes go through the normal
 * diff-approve path so the never-trim guards stay in force.
 */
export async function reviewPart(subject: string, chapter: string, part: number): Promise<Review> {
  const post = await loadPost(subject, chapter, part);
  const book = await loadBook(subject, chapter);
  const postJson = JSON.stringify(post);

  const gates = await runGates(subject, chapter, part);
  const siblings = await siblingParts(subject, chapter, part);

  const pages = await fs.readdir(rendersDir(subject, chapter, part)).catch(() => [] as string[]);
  const pngs = pages
    .filter((f) => /^slide-\d+\.png$/.test(f))
    .sort()
    .map((f) => path.join(rendersDir(subject, chapter, part), f));

  const [facts, visual, pedagogy, brand] = await Promise.all([
    askClaude('facts', [
      'You are fact-checking a technical handbook page set before publication.',
      'Extract every factual claim — complexities, API names and signatures, version behaviour, semantics — and verify it.',
      'Report ONLY claims that are wrong or misleading. Correct-but-terse is fine; do not report style.',
      'Use web search when a claim depends on current library or language behaviour.',
      'Content:', postJson, SHAPE,
    ].join('\n\n'), ['WebSearch', 'WebFetch']),

    pngs.length
      ? askClaude('visual', [
        'You are checking rendered handbook pages for legibility problems before publication.',
        'Look at every image with the Read tool:',
        pngs.map((p) => `- ${p}`).join('\n'),
        'Report only: text cut off at a page edge, blocks overlapping each other, text unreadable against its background, or a page that looks broken.',
        'Do not report taste, colour preference, or density.',
        SHAPE,
      ].join('\n\n'), ['Read'])
      : Promise.resolve<Finding[]>([]),

    askClaude('pedagogy', [
      'You are reviewing the teaching order of a technical handbook before publication.',
      'Report only: a term used before it is defined, a page that depends on a later page, a section in an order that would confuse a learner, or a claim asserted with no supporting example where one is needed.',
      'Do not report wording style or density.',
      book ? `The syllabus this was written from:\n${JSON.stringify(book)}` : '',
      siblings,
      'Content:', postJson, SHAPE,
    ].filter(Boolean).join('\n\n')),

    askClaude('brand', [
      'You are reviewing the caption and titles of an Instagram carousel before publication.',
      'Report only: a caption with no hook in the first sentence, a title that misdescribes its page, hashtags irrelevant to the content, or an inconsistent series title.',
      siblings,
      'Content:', JSON.stringify({ series: post.series, caption: post.caption, titles: post.slides.map((s) => s.page_title) }),
      SHAPE,
    ].filter(Boolean).join('\n\n')),
  ]);

  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const findings = [...gates, ...facts, ...visual, ...pedagogy, ...brand]
    .sort((a, b) => order[a.severity] - order[b.severity] || a.page - b.page);

  const review: Review = {
    generatedAt: new Date().toISOString(),
    part,
    findings,
    passed: reviewPassed(findings),
  };

  await fs.mkdir(partDir(subject, chapter, part), { recursive: true });
  await fs.writeFile(reviewFile(subject, chapter, part), JSON.stringify(review, null, 2));
  return review;
}

export async function loadReview(subject: string, chapter: string, part: number): Promise<Review | null> {
  try {
    return JSON.parse(await fs.readFile(reviewFile(subject, chapter, part), 'utf8')) as Review;
  } catch {
    return null;
  }
}

/** A review counts only while it is newer than the content it judged. */
export async function reviewIsCurrent(subject: string, chapter: string, part: number): Promise<boolean> {
  const review = await loadReview(subject, chapter, part);
  if (!review) return false;
  try {
    const post = await fs.stat(path.join(partDir(subject, chapter, part), 'post.json'));
    return new Date(review.generatedAt) >= post.mtime;
  } catch {
    return false;
  }
}
