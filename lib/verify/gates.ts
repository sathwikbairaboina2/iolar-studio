import type { Block, Slide } from '../schema';

export type Severity = 'blocker' | 'major' | 'minor';

export type Finding = {
  pass: string;
  rule: string;
  severity: Severity;
  page: number; // 1-based; 0 = whole part
  block?: number; // 0-based within the page
  summary: string;
  evidence: string;
  fix: string;
};

const PY = /^py(thon)?$/i;

/** A clause that cannot open a block on its own. */
const ORPHAN_CLAUSE = /^\s*(except|elif|else|finally)\b/;
const DEF_HEADER = /^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;

function indentOf(line: string) {
  return line.length - line.trimStart().length;
}

/**
 * Structural checks that hold whether a snippet is a complete program or an
 * illustrative fragment. These are the shapes that mean the code is *broken*,
 * not merely partial.
 */
export function checkCodeBlock(block: Block, page = 0, blockIndex?: number): Finding[] {
  if (block.type !== 'code') return [];
  if (!PY.test(block.lang)) return [];

  const lines = block.lines;
  const meaningful = lines.filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!meaningful.length) return [];

  const out: Finding[] = [];
  const at = (rule: string, severity: Severity, summary: string, evidence: string, fix: string) =>
    out.push({ pass: 'code', rule, severity, page, block: blockIndex, summary, evidence, fix });

  // A block whose first meaningful line is indented lost its opening header.
  if (indentOf(meaningful[0]) > 0) {
    at(
      'code.severed', 'blocker',
      'Code block starts indented — its class or function header is missing.',
      meaningful[0].trim().slice(0, 80),
      'Include the enclosing `class`/`def` line, or dedent the snippet to stand alone.'
    );
  }

  // A def/class header with nothing indented under it.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DEF_HEADER);
    if (!m || !lines[i].trimEnd().endsWith(':')) continue;
    const headIndent = indentOf(lines[i]);
    let body = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      body = indentOf(lines[j]) > headIndent;
      break;
    }
    if (!body) {
      at(
        'code.empty-body', 'blocker',
        `\`${m[2]}\` is declared with no body.`,
        lines[i].trim().slice(0, 80),
        'Write the body, or drop the header and show only the call site.'
      );
    }
  }

  // except/else/elif/finally with no opener above it at the same indent.
  for (let i = 0; i < lines.length; i++) {
    if (!ORPHAN_CLAUSE.test(lines[i])) continue;
    const indent = indentOf(lines[i]);
    let opened = false;
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j].trim()) continue;
      const ind = indentOf(lines[j]);
      if (ind < indent) break;
      if (ind === indent && /^\s*(try|if|for|while)\b/.test(lines[j])) { opened = true; break; }
    }
    if (!opened) {
      at(
        'code.orphan-clause', 'blocker',
        'Clause has no matching `try`/`if`/`for` above it.',
        lines[i].trim().slice(0, 80),
        'Include the opening statement, or drop this clause.'
      );
    }
  }

  // The same top-level name defined twice inside one block reads as a mistake.
  const names = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(DEF_HEADER);
    if (!m || indentOf(line) > 0) continue;
    const name = m[2];
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  for (const [name, count] of names) {
    if (count > 1) {
      at(
        'code.redefined', 'major',
        `\`${name}\` is defined ${count} times in one block.`,
        `def ${name}(...)`,
        'Split the variants into separate blocks, or keep the one being taught.'
      );
    }
  }

  return out;
}

export function checkTables(block: Block, page = 0, blockIndex?: number): Finding[] {
  if (block.type !== 'table') return [];
  const width = block.headers.length;
  const out: Finding[] = [];
  block.rows.forEach((row, i) => {
    if (row.length !== width) {
      out.push({
        pass: 'code', rule: 'table.shape', severity: 'blocker', page, block: blockIndex,
        summary: `Row ${i + 1} has ${row.length} cells but the table has ${width} columns.`,
        evidence: row.join(' | ').slice(0, 80),
        fix: `Add or remove cells so every row has ${width}.`,
      });
    }
  });
  return out;
}

/** "AWS VPC (cont.)" and "AWS VPC" are the same section. */
const baseTitle = (t: string) => t.replace(/ \(cont\.\)$/, '').trim().toLowerCase();

/**
 * Headings repeat across a part when the planner loses track of what it already wrote.
 * They also repeat legitimately: a notes chapter gives every service its own "Best
 * Practices". Same section is the planner losing track; different sections is the shape of
 * the material, so it is recorded and not treated as a defect to fix.
 */
export function checkHeadings(slides: Slide[]): Finding[] {
  const seen = new Map<string, { page: number; section: string }>();
  const out: Finding[] = [];
  slides.forEach((slide, si) => {
    const section = baseTitle(slide.page_title ?? '');
    slide.blocks.forEach((b, bi) => {
      if (b.type !== 'heading') return;
      const key = b.text.replace(/^\s*\d+[.)]\s*/, '').trim().toLowerCase();
      if (!key) return;
      const first = seen.get(key);
      if (first !== undefined) {
        const sameSection = first.section === section;
        out.push({
          pass: 'code', rule: 'heading.unique', severity: sameSection ? 'major' : 'minor',
          page: si + 1, block: bi,
          summary: `Heading "${b.text}" already appears on page ${first.page}.`,
          evidence: b.text,
          fix: sameSection
            ? 'Rename this section, or merge it with the earlier one.'
            : 'Fine if the two pages cover different topics; rename if they do not.',
        });
      } else {
        seen.set(key, { page: si + 1, section });
      }
    });
  });
  return out;
}

/**
 * A heading drawn as the last block of a page sits alone above blank space while its
 * section opens the next one. The layout keeps a heading with its block only within a page,
 * so the break has to be fixed in the content: move the heading down.
 */
export function checkStrandedHeadings(slides: Slide[]): Finding[] {
  const out: Finding[] = [];
  slides.slice(0, -1).forEach((slide, si) => {
    const bi = slide.blocks.length - 1;
    const last = slide.blocks[bi];
    if (last?.type !== 'heading') return;
    out.push({
      pass: 'code', rule: 'heading.stranded', severity: 'major', page: si + 1, block: bi,
      summary: `Page ${si + 1} ends on the heading "${last.text}"; its section starts on page ${si + 2}.`,
      evidence: last.text,
      fix: `Move the heading to the top of page ${si + 2}, above the block it introduces.`,
    });
  });
  return out;
}
