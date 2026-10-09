import type { Book } from '@/lib/ai/book';
import { stripInline } from '@/lib/renderer/inline';
import type { Post } from '@/lib/schema';

/** Block types the aiiolar reader draws, one JSON example each. */
export const BLOCK_EXAMPLES = `Allowed blocks (nothing else; no labelrows, no concept, no cover pages):
{"type":"heading","text":"A short heading"}
{"type":"paragraph","text":"Full sentences with **bold** terms, ==marks== and \`code\`."}
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

export const INLINE_SYNTAX = `Inline text (paragraph, bullets, table cells, callouts, qa) uses only: **bold**, ==mark==, \`code\`, __underline__, {icon:name}, and {blue|red|green|black|purple|orange|pink:text}. No single-asterisk italics, no markdown headings, no markdown links.`;

export const EDITION_RULES = [
  'You are writing one section of a web chapter that a learner reads on a page, top to bottom.',
  BLOCK_EXAMPLES,
  INLINE_SYNTAX,
  'Worked examples: a runnable example is a `python` code block immediately followed by a code block with lang "output" holding exactly what the program prints. The code must run on Python 3.11 with the standard library only, finish in a couple of seconds, and print exactly that output. Later examples may use names that earlier examples in the chapter defined.',
  'Use a table for every set of comparison rows in the points.',
  'Use a flow, chain or flowchart for every process or decision.',
  'Write common mistakes as callouts with style sticky.',
  'No single-asterisk italics, no markdown headings or links.',
  "Write for reading on a page: no 'swipe', 'next slide' or page numbers. Explain an idea in prose before showing code for it; do not turn the section into bullet dumps.",
  'Every page has a title and at least one block. Use one to four pages per section.',
  'Answer shape, as ONE JSON object and nothing else (no prose, no markdown fences): {"title": string, "pages": [{"title": string, "blocks": [...]}]}',
].join('\n\n');

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

const SOURCE_NOTE = 'Source material (facts and examples you may reuse; do not copy slide phrasing):';

export function sectionPrompt(opts: {
  book: Book;
  chapterTitle: string;
  role: 'intro' | 'outline' | 'quiz';
  outlineIndex?: number;
  carousel: string;
  notes?: string[];
  error?: string;
}): string {
  const { book, role } = opts;
  const out: string[] = [EDITION_RULES, `Chapter: ${opts.chapterTitle}. ${book.summary}`];
  if (role === 'intro') {
    out.push(
      'Write the INTRODUCTION: one page titled for what the chapter teaches, 2 to 3 paragraphs saying why it matters and what the learner can do afterwards, and a tip callout with prerequisites or setup.',
      `The chapter's outline, for orientation:\n${book.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}`,
    );
  } else if (role === 'quiz') {
    out.push(
      'Write the QUIZ AND SUMMARY: section title "Check yourself" with two pages. Page "Quiz": 3 to 5 qa blocks that test understanding (predict output, spot the bug), not recall of wording. Page "Summary": one bullets block (style "check") of 4 to 7 one-line takeaways.',
      `Everything the chapter covers:\n${book.chapters.map((c) => `- ${c.title}: ${c.points.join('; ')}`).join('\n')}`,
    );
  } else {
    const section = book.chapters[opts.outlineIndex ?? 0];
    out.push(
      `Write the section "${section.title}". Cover EVERY point below, each in its own words with an example, table or diagram where the point calls for one. The points are the checklist:\n${section.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
      `For orientation, the chapter's sections:\n${book.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}`,
    );
  }
  out.push(`${SOURCE_NOTE}\n${opts.carousel}`);
  if (opts.notes?.length) out.push(`Fix these problems from the review:\n${opts.notes.map((n) => `- ${n}`).join('\n')}`);
  if (opts.error) out.push(`Your previous answer was rejected: ${opts.error}\nReturn the corrected JSON object.`);
  return out.join('\n\n');
}
