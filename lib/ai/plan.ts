import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost, MAX_SLIDES } from '../schema';
import { getSettings } from '../settings';
import { savePost, loadPost } from '../store';
import { refsDir } from '../paths';
import { runClaude } from './claude';
import { extractJson } from './revise';
import { Book, bookFromReferences, bookFromTopic, loadBook } from './book';

const SCHEMA_RULES = `Return ONLY a complete post JSON object (no prose, no markdown fences) with this exact shape:
{
  "brand": string, "template": one of ["spiral-notes","margin-qa","blackboard","studygram-pastel","engineer-grid","terminal-dark","legal-pad","sticky-wall"],
  "ratio": "3:4", "seed": integer,
  "series": string (short series title, uppercase),
  "date": string (DD/MM/YYYY),
  "slides": [ { "page_title": string, "blocks": [Block, ...] }, ... ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Block types (discriminated by "type"):
- {"type":"heading","text":string,"ink"?:"blue"|"red"|"green"|"black"|"accent"}
- {"type":"paragraph","text":string}
- {"type":"bullets","items":[string,...]}
- {"type":"sidebox","title":string,"items":[string,...],"ink"?:string}
- {"type":"table","headers":[string,...],"rows":[[string,...],...]}
- {"type":"code","lang":string,"lines":[string,...]}
- {"type":"diagram","kind":"flow","spec":{"nodes":[string,...]}}
- {"type":"callout","style":"tip"|"takeaway"|"cloud","title":string,"text":string}
- {"type":"qa","q":string,"a_bullets":[string,...],"example_code"?:[string,...]}

"page_title" is the section name ONLY — never write "Page 3:" or a page number in it; the template adds that.

WRITE SHORT BLOCKS, MANY OF THEM. This is the single most important rule. Real study-notes
pages are dense because they carry MANY SMALL items, not a few long ones. A page is a
TWO-COLUMN grid holding about 70 short lines, and short blocks pair up side by side.

Per-block ceilings — treat these as hard:
- bullets: 3-5 items, each ONE line (max 12 words). Never a paragraph inside a bullet.
- paragraph: at most 2 short sentences. Prefer bullets; use paragraph sparingly.
- table: 3-5 rows, 2-4 columns, cells of 1-3 words. Terse ("O(1) avg", not "on average constant time").
- code: 3-5 lines, each under 45 characters, with a short trailing # comment where it teaches something.
- sidebox / callout: title plus 2-4 one-line items.
- heading: a 2-5 word section label; number them (1., 2., 3. ...).

Each block should render in about 4-6 lines. A block that runs past ~8 lines is too long —
split it into two blocks or cut words.

PER-SLIDE TARGET: 12-16 blocks, i.e. 4-6 numbered sections each followed by its bullets,
table, or code. Fewer than 10 blocks means the page will render half empty.

SLIDE COUNT: exactly ${MAX_SLIDES} slides unless the book truly cannot fit. Divide the book's
points evenly — with N points that is about N/${MAX_SLIDES} points per slide, and each point
should become one short bullet, one table row, or one code line, NOT a paragraph.`;

function envelope(brand: string, template: string, ratio: string) {
  return `Use "brand": "${brand}", "template": "${template}", "ratio": "${ratio}", "seed": 42, today's date ${new Date().toLocaleDateString('en-GB')}. Write an engaging caption (2-3 sentences, hook first) and 8-12 relevant hashtags.`;
}

async function generate(prompt: string, allowedTools?: string[]): Promise<Post> {
  const first = await runClaude(prompt, { timeoutMs: 900_000, allowedTools });
  try {
    return validatePost(extractJson(first));
  } catch (err) {
    const retry = await runClaude(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return corrected JSON only.`,
      { timeoutMs: 900_000, allowedTools }
    );
    return validatePost(extractJson(retry));
  }
}

export async function downloadReferences(subject: string, chapter: string, urls: string[]): Promise<string[]> {
  const dir = refsDir(subject, chapter);
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i]);
    if (!r.ok) throw new Error(`reference ${i + 1} fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = path.join(dir, `ref-${String(i + 1).padStart(2, '0')}.jpg`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
}

/** Step 1 of the pipeline: build the book (syllabus) from references or a topic. */
export async function planBook(
  subject: string, chapter: string, mode: 'topic' | 'references', input: string | string[]
): Promise<Book> {
  if (mode === 'references') {
    const files = await downloadReferences(subject, chapter, input as string[]);
    return bookFromReferences(subject, chapter, files);
  }
  return bookFromTopic(subject, chapter, input as string);
}

/** Step 2: turn the approved book into slides — every point must be covered somewhere. */
export async function planSlidesFromBook(subject: string, chapter: string, part: number): Promise<Post> {
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('no book yet — generate the book first');
  const s = getSettings();
  const existing = await loadPost(subject, chapter, part).catch(() => null);

  const totalPoints = book.chapters.reduce((n, c) => n + c.points.length, 0);
  const hasLayout = book.chapters.some((c) => c.layout?.length);

  // Knowledge-graph context: what other posts in this account already teach.
  let covered: string[] = [];
  try {
    const { coveredElsewhere } = await import('../graph');
    covered = coveredElsewhere(subject, chapter);
  } catch { /* graph optional */ }

  const prompt = [
    `You are the content designer for "${s.brand}", an Instagram account publishing tech handbooks as handwritten-notes carousels.`,
    'Here is the approved book (syllabus). EVERY point in it must be taught somewhere in the slides — nothing may be dropped:',
    JSON.stringify(book),
    hasLayout
      ? `Each chapter was read from one reference page and carries a "layout": the exact block sequence that page used. Write ONE SLIDE PER CHAPTER, in order, emitting those block types in that order — if the layout says heading, bullets, sidebox, table, code, callout, then produce exactly that sequence, filled with this chapter's own points. Mirror the reference page's shape; write original wording.`
      : `That is ${book.chapters.length} chapters and ${totalPoints} points. Choose the slide count that covers them all at full page density; keep the book's order.`,
    'Write original prose — teach each point concretely with real examples, tables and code, the way dense study notes do.',
    covered.length
      ? `Other posts on this account already cover these topics — do not rehash them at length; reference them briefly if needed and spend the space on this book's own material:\n${covered.join(', ')}`
      : '',
    SCHEMA_RULES,
    envelope(s.brand, existing?.template ?? s.defaultTemplate, existing?.ratio ?? s.defaultRatio),
  ].filter(Boolean).join('\n\n');

  const post = await generate(prompt);
  await savePost(subject, chapter, part, post);
  return post;
}

/** Ask the AI to grow under-filled slides using the book, without touching the ones that fit. */
export async function densifySlides(
  subject: string, chapter: string, part: number,
  underfilled: { slide: number; fillPct: number }[]
): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const book = await loadBook(subject, chapter);
  const list = underfilled.map((u) => `slide ${u.slide} (only ${u.fillPct}% full)`).join(', ');
  const prompt = [
    'You are tightening a handwritten-notes carousel so every page looks fully used.',
    `These slides have wasted space: ${list}. Grow ONLY those slides toward ~100% fill by adding genuinely useful content — another numbered section, more table rows, an extra example, a tip callout. Do not pad with filler and do not touch the other slides.`,
    book ? `The book (syllabus) for this post — prefer adding points from it that are thin or missing:\n${JSON.stringify(book)}` : '',
    'Current post JSON:',
    JSON.stringify(post),
    SCHEMA_RULES,
  ].filter(Boolean).join('\n\n');

  return generate(prompt);
}
