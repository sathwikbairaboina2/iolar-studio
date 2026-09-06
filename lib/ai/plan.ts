import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost, MAX_SLIDES } from '../schema';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { templateManifest } from '../renderer/page';
export { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { getSettings } from '../settings';
import { savePost, loadPost } from '../store';
import { refsDir } from '../paths';
import { thinker } from './runner';
import { extractJson } from './revise';
import { Book, bookFromReferences, bookFromTopic, loadBook } from './book';

function envelope(brand: string, template: string, ratio: string) {
  return `Use "brand": "${brand}", "template": "${template}", "ratio": "${ratio}", "seed": 42, today's date ${new Date().toLocaleDateString('en-GB')}. Write an engaging caption (2-3 sentences, hook first) and 8-12 relevant hashtags.`;
}

async function generate(prompt: string, allowedTools?: string[]): Promise<Post> {
  const first = await thinker()(prompt, { timeoutMs: 900_000, allowedTools });
  try {
    return validatePost(extractJson(first));
  } catch (err) {
    const retry = await thinker()(
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

/** The family's own page recipe, read from its manifest; empty when a template has none. */
export function familyRecipe(template: string): string {
  try {
    const r = templateManifest(template).recipe;
    return r ? `FAMILY "${template}": ${r}` : '';
  } catch {
    return '';
  }
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
    const { coveredElsewhere } = await import('../knowledge/spaces/handbooks');
    covered = await coveredElsewhere(subject, chapter);
  } catch { /* graph optional */ }

  const prompt = [
    `You are the content designer for "${s.brand}", an Instagram account publishing tech handbooks as handwritten-notes carousels.`,
    'Here is the approved book (syllabus). EVERY point in it must be taught somewhere in the slides — nothing may be dropped:',
    JSON.stringify(book),
    hasLayout
      ? `Each chapter was read from one reference page and carries a "layout": the block sequence that page used, with a note per block. Treat it as a HINT about density and section order, not an order: write one slide per chapter, keep the reference's section order and its density, but choose the best block for each point — an "array" where the page drew cells, "cards" with icons where it drew a strip of concepts, "schema" or "tables" where it drew example tables, a titled icon "flowchart" where it drew a service diagram. Write original wording.`
      : `That is ${book.chapters.length} chapters and ${totalPoints} points. Each chapter carries a "shape": the section roles that page should have, in order (definition, mechanism, example, comparison, mistakes, summary, cheatsheet, cover). Give every chapter one slide built from its shape, at full page density; keep the book's order.`,
    familyRecipe(existing?.template ?? s.defaultTemplate),
    'Write original prose — teach each point concretely with real examples, tables and code, the way dense study notes do.',
    RECIPE_GUIDANCE,
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
