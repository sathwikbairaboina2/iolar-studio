import { promises as fs } from 'fs';
import path from 'path';
import { loadPost } from '../store';
import { getSettings } from '../settings';
import { rendersDir } from '../paths';
import { loadBook } from '../ai/book';
import { uncoveredPoints } from '../ai/fit';
import { checkCodeBlock, checkTables, checkHeadings, type Finding } from './gates';
import { runPython, expectedOutput, outputMatches } from './sandbox';

/** Dropping one of these is a safety problem, not a trim. */
const CAVEAT = /security|leak|spoof|inject|auth|escape|sanitiz|overflow|race|deadlock|corrupt/i;

export async function runGates(subject: string, chapter: string, part: number): Promise<Finding[]> {
  const post = await loadPost(subject, chapter, part);
  const findings: Finding[] = [...checkHeadings(post.slides)];

  // Structural checks on every block.
  post.slides.forEach((slide, si) => {
    slide.blocks.forEach((b, bi) => {
      findings.push(...checkCodeBlock(b, si + 1, bi), ...checkTables(b, si + 1, bi));
    });
  });

  // Execute the snippets that claim to be complete programs.
  for (const [si, slide] of post.slides.entries()) {
    for (const [bi, b] of slide.blocks.entries()) {
      if (b.type !== 'code' || !b.runnable || !/^py(thon)?$/i.test(b.lang)) continue;
      const code = b.lines.join('\n');
      const result = await runPython(code);

      if (result.stderr.includes('python not available')) continue; // no interpreter: skip, do not fail

      if (!result.ok) {
        findings.push({
          pass: 'code', rule: result.timedOut ? 'code.timeout' : 'code.execute',
          severity: 'blocker', page: si + 1, block: bi,
          summary: result.timedOut
            ? 'Runnable snippet did not finish within 5 seconds.'
            : 'Runnable snippet fails when executed.',
          evidence: (result.stderr.trim().split('\n').pop() ?? code.split('\n')[0]).slice(0, 120),
          fix: 'Fix the snippet, or mark it `runnable: false` if it is only illustrative.',
        });
        continue;
      }

      const claim = expectedOutput(b.lines);
      if (claim && !outputMatches(result.stdout, claim)) {
        findings.push({
          pass: 'code', rule: 'code.output', severity: 'major', page: si + 1, block: bi,
          summary: 'Snippet output does not match the value in its comment.',
          evidence: `comment says ${claim}; actual ${result.stdout.trim().slice(0, 60) || '(no output)'}`,
          fix: 'Correct the comment, or fix the code so it produces the stated value.',
        });
      }
    }
  }

  // Every book point must survive; safety caveats block.
  const book = await loadBook(subject, chapter);
  if (book) {
    for (const point of uncoveredPoints(book, post)) {
      const caveat = CAVEAT.test(point);
      findings.push({
        pass: 'coverage', rule: caveat ? 'coverage.caveat' : 'coverage.points',
        severity: caveat ? 'blocker' : 'major', page: 0,
        summary: caveat
          ? 'A safety caveat from the book is missing from these pages.'
          : 'A book point is missing from these pages.',
        evidence: point.slice(0, 120),
        fix: 'Add this point to a page — the fit pass may only add, so it is safe to run.',
      });
    }
  }

  // Fill and overflow, read from the last render.
  try {
    const report = JSON.parse(
      await fs.readFile(path.join(rendersDir(subject, chapter, part), 'render-report.json'), 'utf8')
    ) as Record<string, { overflowPx: number; fillPct?: number }>;
    for (const [slide, r] of Object.entries(report)) {
      const page = Number(slide);
      if (page > post.slides.length) continue; // stale row from an earlier, longer render
      if (r.overflowPx > 0) {
        findings.push({
          pass: 'coverage', rule: 'page.overflow', severity: 'blocker', page,
          summary: `Page overflows by ${r.overflowPx}px.`, evidence: `overflowPx ${r.overflowPx}`,
          fix: 'Re-render — auto-flow moves the excess onto the next page.',
        });
      }
      if (typeof r.fillPct === 'number' && r.fillPct < 70) {
        findings.push({
          pass: 'coverage', rule: 'page.fill', severity: 'major', page,
          summary: `Page is only ${r.fillPct}% full.`, evidence: `fillPct ${r.fillPct}`,
          fix: 'Run the fit pass — it adds material from the book without removing anything.',
        });
      }
    }
  } catch { /* never rendered: nothing to judge */ }

  // Brand shape.
  const brand = getSettings().brand;
  if (post.brand !== brand) {
    findings.push({
      pass: 'brand', rule: 'brand.handle', severity: 'minor', page: 0,
      summary: `Brand handle is "${post.brand}" but settings say "${brand}".`,
      evidence: post.brand, fix: `Set the post brand to "${brand}".`,
    });
  }
  if (!post.caption.text.trim()) {
    findings.push({
      pass: 'brand', rule: 'brand.caption', severity: 'minor', page: 0,
      summary: 'Caption is empty.', evidence: '(empty)', fix: 'Write a 2-3 sentence caption with a hook first.',
    });
  }
  const tags = post.caption.hashtags.length;
  if (tags && (tags < 5 || tags > 15)) {
    findings.push({
      pass: 'brand', rule: 'brand.hashtags', severity: 'minor', page: 0,
      summary: `${tags} hashtags — aim for 5 to 15.`, evidence: post.caption.hashtags.join(' ').slice(0, 80),
      fix: 'Trim or add hashtags to land in the 5-15 range.',
    });
  }

  const order = { blocker: 0, major: 1, minor: 2 } as const;
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.page - b.page);
}
