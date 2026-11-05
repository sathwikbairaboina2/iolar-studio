import type { Book } from '@/lib/ai/book';
import { isLabelCover, type HandbookCategory } from '@/lib/handbookCategories';
import { stripInline } from '@/lib/renderer/inline';
import type { Post } from '@/lib/schema';
import {
  DEFAULT_CAPS, MAX_BULLET_CHARS, MAX_CODE_LINES, MAX_PARAGRAPHS_PER_PAGE, MAX_PARAGRAPH_CHARS, capsFor, type PageCaps,
} from './edition';
import { EXAMPLE_PAGES } from './examples';

/** Block types the aiiolar reader draws, one JSON example each. */
export const BLOCK_EXAMPLES = `Allowed blocks (nothing else; no labelrows, no concept, no cover pages):
{"type":"heading","text":"A short heading"}
{"type":"paragraph","text":"One short line of context with **bold** terms (rare; prefer bullets)."}
{"type":"bullets","items":["one","two"],"style":"check"}
{"type":"code","lang":"python","lines":["print('hi')"],"note":"optional caption","result":{"headers":["a"],"rows":[["1"]]}}
{"type":"code","lang":"output","lines":["hi"]}
{"type":"table","headers":["","Threads","asyncio"],"rows":[["Switches","The OS","Your code"]],"highlightRow":1}
{"type":"callout","style":"tip","title":"Before you start","text":"..."}   (style: tip | takeaway | sticky)
{"type":"sidebox","title":"Safe from another thread","items":["...","..."],"ink":"orange"}
{"type":"qa","q":"A question?","a_bullets":["the answer","why"],"example_code":["optional","lines"]}
Diagrams are ALWAYS written {"type":"diagram","kind":KIND,"spec":SPEC} (for example {"type":"diagram","kind":"flow","spec":{"nodes":[...]}}), never with the kind as the block type. Kinds:
flow       {"nodes":[{"text":"Step","sub":"detail","ink":"blue"}]}
chain      {"title":"optional","steps":[{"text":"Step","note":"detail","ink":"blue"}]}
flowchart  {"title":"optional","rows":[["q1"],["a","b"]],"nodes":{"q1":{"text":"Question?","shape":"diamond"},"a":{"text":"Yes","shape":"box","ink":"green"},"b":{"text":"No","shape":"pill"}},"edges":[{"from":"q1","to":"a","label":"yes"},{"from":"q1","to":"b","label":"no"}]}
cards      {"cards":[{"title":"Card","lines":["a","b"],"icon":"python","ink":"blue"}]}
array      {"cells":["1","2","3"],"indices":true,"pointers":[{"index":0,"label":"head"}],"highlight":[1],"caption":"optional"}
matrix     {"rows":[["a","b"],["c","d"]],"highlight":[[0,1]],"caption":"optional"}
tables     {"tables":[{"title":"optional","headers":["h"],"rows":[["r"]]}],"arrow":false}
schema     {"tables":[{"name":"users","columns":["id","name"]}],"links":[{"from":"orders","to":"users"}]}
er         {"entities":[{"name":"User","attrs":["id"]}],"relations":[{"from":"User","to":"Order","name":"places"}]}
ink values: blue, red, green, black, purple, orange, pink. Never use the diagram kinds compare, tree or memory-cells.`;

export const INLINE_SYNTAX = `Inline text (paragraph, bullets, table cells, callouts, qa) uses only: **bold**, ==mark==, \`code\`, __underline__, {icon:name}, and {blue|red|green|black|purple|orange|pink:text}. No single-asterisk italics, no markdown headings, no markdown links. Python names with double underscores always go in code, like \`__init__\`: bare, they draw as an underlined word.`;

/** The limits validateEdition enforces, in words the writer can follow. */
export const capsText = (caps: PageCaps) => `Hard limits, checked by a program (a page over any of them is thrown away): at most ${caps.blocks} blocks on the page, at most ${caps.code} code blocks (an output block does not count), at most ${caps.tables} tables, at most ${caps.codeLines} lines per code block, at most ${MAX_PARAGRAPHS_PER_PAGE} paragraph of at most ${MAX_PARAGRAPH_CHARS} characters, and every bullet item at most ${MAX_BULLET_CHARS} characters${caps.words ? `, and at most ${caps.words} words of visible text on the page in all (cut to the must-know lines)` : ''}.`;

export const CAPS_TEXT = capsText(DEFAULT_CAPS);

const NOTES_SHAPE =`The page has 2 to 4 mini-sections, each a heading block (numbered, "1. What the loop is", with an ink) followed by its notes. Notes are: one-line bullets with the key words in ==marks== or {ink:...} (one idea per bullet, a fragment is fine), compact tables, a small flow, chain or flowchart for every process or decision, code of at most ${MAX_CODE_LINES} lines (an output block right after it whenever it prints something), one callout with style sticky for the thing to remember, a sidebox for rules. Write only what is worth revising. No filler: no motivation, no restating the heading, no sentence that says what the page will cover. Code only when the code is itself the thing to remember (a command, an API call, a syntax); never a demo that only prints constants or arithmetic. No interview questions or qa blocks on a notes page; the quiz page has those. A page that is half full is fine; never pad it to fill the space.`;

const QA_SHAPE = 'Every point is one interview question. Write each as ONE qa block: q is "Q<n>. " plus the question as the point words it (keep its wording), a_bullets open with the one-sentence answer, then at most 3 key points of one line each; example_code (at most 8 lines) only when code is the answer. No heading blocks between questions. After the questions, at most one table or diagram where it compares what the answers compare.';

const DRILLS_SHAPE = 'Every point is one drill. Write each as a heading "Q<n>. <the task in at most 8 words>" then ONE code block of at most 8 lines that solves it, then its result: for SQL a `result` table on the code block (at most 4 rows, 4 columns), for Python an `output` block. Use only the dataset below; every result is computed from exactly those rows.';

const CHEATSHEET_SHAPE = "This is the chapter's cheat sheet: compact tables and one-line bullets of the must-know facts, no new material.";

type Role = 'intro' | 'outline' | 'quiz';

/** What the page looks like: notes for most categories, one qa block per question for a Q&A bank, one task and its result for drills. */
function shapeRule(category: HandbookCategory, role: Role, shape?: string[], dataset?: string): string {
  if (role !== 'outline') return NOTES_SHAPE;
  if (shape?.includes('cheatsheet')) return `${NOTES_SHAPE} ${CHEATSHEET_SHAPE}`;
  if (category.id === 'interview-qa') return QA_SHAPE;
  if (category.id === 'drills') return [DRILLS_SHAPE, dataset].filter(Boolean).join('\n\n');
  return shape?.length ? `${NOTES_SHAPE} Order the mini-sections by the section's roles: ${shape.join(', ')}.` : NOTES_SHAPE;
}

/** The edition rules; the page-shape rule depends on the chapter's category and the section's roles. */
export const editionRules = (category: HandbookCategory, role: Role, shape?: string[], dataset?: string) => [
  'You are writing one page of REVISION NOTES in a web handbook: the page a learner scans the night before an exam. Notes, not prose.',
  BLOCK_EXAMPLES,
  'Bullets take a style (dot, number, check, cross, checkbox, star), a frame ("dashed") and an ink; headings, sideboxes and bullets take an ink.',
  INLINE_SYNTAX,
  shapeRule(category, role, shape, dataset),
  capsText(capsFor(category.id)),
  'Worked examples: a runnable example is a `python` code block immediately followed by a code block with lang "output" holding exactly what the program prints. The code must run on Python 3.11 with the standard library only, finish in a couple of seconds, and print exactly that output. Later examples may use names that earlier examples on the page defined.',
  'Always state the idea in a bullet before any code that shows it: a learner should never meet code first.',
  'Never list a question without its answer. A question on the page is a qa block, or a bullet with the question in bold followed by its one-line answer.',
  'Use a table for every set of comparison rows in the points.',
  'Write common mistakes as callouts with style sticky, or as bullets with style cross.',
  'No single-asterisk italics, no markdown headings or links.',
  "Write for reading on a page: no 'swipe', 'next slide' or page numbers.",
  'Answer shape, as ONE JSON object and nothing else (no prose, no markdown fences): {"title": string, "pages": [{"title": string, "blocks": [...]}]} with exactly one page.',
].join('\n\n');

const styleExamples = () =>
  `Two example pages from the paperback, as JSON. Match their mix of blocks, not their length; do not copy their facts:\n${EXAMPLE_PAGES.map((p) => JSON.stringify(p)).join('\n')}`;

const SKIP_KEYS = new Set(['type', 'kind', 'style', 'ink', 'icon', 'frame', 'lang']);
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(stripInline(v));
  else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) texts(x, out);
  return out;
}

/** The carousel's words, part by part, as source material (page titles kept). */
export function carouselText(posts: Post[]): string {
  return posts
    .map((p, i) => `## Part ${i + 1}\n${p.slides.map((s) => `### ${s.page_title}\n${texts(s.blocks).join('\n')}`).join('\n\n')}`)
    .join('\n\n');
}

/** The most source text one prompt carries. */
export const SOURCE_LIMIT = 12_000;

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'are', 'not']);
const titleWords = (s: string) => new Set((stripInline(s).toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w)));

/**
 * The carousel pages that cover one section: those whose title shares half its words with the section's, then
 * those whose text holds a third of the section's longer words (at most three). Without a match, the whole
 * carousel. Cut to SOURCE_LIMIT characters either way.
 */
export function carouselFor(posts: Post[], section?: { title: string; points: string[] }): string {
  const whole = () => carouselText(posts).slice(0, SOURCE_LIMIT);
  if (!section) return whole();
  const pages = posts.flatMap((p) => p.slides.map((s) => ({ title: s.page_title, body: texts(s.blocks).join('\n') })));
  const want = titleWords(section.title);
  const longWords = new Set((stripInline(section.points.join(' ')).toLowerCase().match(/[a-z][a-z0-9_]{6,}/g) ?? []));
  const picked = new Set<number>();
  const scored: { i: number; score: number }[] = [];
  pages.forEach((pg, i) => {
    const have = titleWords(pg.title);
    const both = [...want].filter((w) => have.has(w)).length;
    const union = new Set([...want, ...have]).size;
    if (union && both / union >= 0.5) picked.add(i);
    else if (longWords.size) {
      const text = titleWords(pg.body + ' ' + pg.title);
      const hit = [...longWords].filter((w) => text.has(w)).length;
      if (hit / longWords.size >= 0.33) scored.push({ i, score: hit / longWords.size });
    }
  });
  scored.sort((a, b) => b.score - a.score).slice(0, 3).forEach((x) => picked.add(x.i));
  if (!picked.size) return whole();
  return [...picked].sort((a, b) => a - b).map((i) => `### ${pages[i].title}\n${pages[i].body}`).join('\n\n').slice(0, SOURCE_LIMIT);
}

const SOURCE_NOTE = 'Source material, the paperback pages for this (facts and examples you may reuse; do not copy slide phrasing):';

export function sectionPrompt(opts: {
  book: Book;
  chapterTitle: string;
  role: 'intro' | 'outline' | 'quiz';
  outlineIndex?: number;
  carousel: string;
  category: HandbookCategory;
  /** The section's roles from book.json (definition, example, cheatsheet, ...). */
  shape?: string[];
  /** The book's one dataset, as datasetRules writes it (drills only). */
  dataset?: string;
  notes?: string[];
  error?: string;
}): string {
  const { book, role } = opts;
  const out: string[] = [editionRules(opts.category, role, opts.shape, opts.dataset), `Chapter: ${opts.chapterTitle}. ${book.summary}`];
  if (role === 'intro') {
    out.push(
      'Write the INTRODUCTION: one page titled for what the chapter teaches, as notes: 3 to 5 one-line bullets on why it matters and what the learner can do afterwards, and a tip callout with prerequisites or setup.',
      `The chapter's outline, for orientation:\n${book.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}`,
    );
  } else if (role === 'quiz') {
    out.push(
      'Write the QUIZ: section title "Check yourself" with exactly ONE page titled "Check yourself" holding 3 to 5 qa blocks and nothing else. The questions test understanding (predict output, spot the bug), not recall of wording. Keep every answer to a few short bullet lines. A wrong answer teaches something false, so work through each one before you write it.',
      ...(capsFor(opts.category.id).words ? [`The quiz page has the same ${capsFor(opts.category.id).words}-word limit as every page, questions and answers together: write 3 questions, each answer one or two short lines.`] : []),
      `Everything the chapter covers:\n${book.chapters.map((c) => `- ${c.title}: ${c.points.join('; ')}`).join('\n')}`,
    );
  } else {
    const section = book.chapters[opts.outlineIndex ?? 0];
    out.push(
      styleExamples(),
      `Category: ${opts.category.name}. ${opts.category.content.rules.join(' ')}`,
      `Write the section "${section.title}" as ONE page of notes, the page title exactly "${section.title}". Every point below must show up on the page as a short note (a bullet, a table row, a node of a diagram, a line of code), with an example, table or diagram where the point calls for one. The points are the checklist:\n${section.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
      `The chapter's fixed facts: the outline of the whole chapter, every section with its points. Numbers, names, states and schemas stated here are fixed: reuse them exactly and never contradict them. This page covers only its own checklist above; do not teach the other sections.\n${book.chapters.filter((c) => !isLabelCover(c)).map((c) => `- ${c.title}: ${c.points.join('; ')}`).join('\n')}`,
    );
  }
  out.push(`${SOURCE_NOTE}\n${opts.carousel}`);
  if (opts.notes?.length) out.push(`Fix these problems from the review:\n${opts.notes.map((n) => `- ${n}`).join('\n')}`);
  if (opts.error) out.push(`Your previous answer was rejected: ${opts.error}\nReturn the corrected JSON object.`);
  return out.join('\n\n');
}
