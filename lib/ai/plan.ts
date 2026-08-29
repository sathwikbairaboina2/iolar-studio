import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost, MAX_SLIDES } from '../schema';
import { getSettings } from '../settings';
import { postDir, savePost, loadPost } from '../store';
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

FILL THE PAGE. Each slide is a full handwritten notebook page and must look densely used, like real study notes — never half empty. Target 45-55 rendered lines per slide, where: heading = 1 line, each bullet = 1 line, each table row = 1 line (plus 1 for headers), each code line = 1 line, paragraph = 1 line per 85 characters, callout/sidebox = 2 lines plus its items. That is normally 7-10 blocks per slide with 3-5 numbered sections. Going a little under is wasted space; going over is rejected as overflow. Aim for 50 lines.

HARD LIMIT: at most ${MAX_SLIDES} slides. Tables max 6 rows x 4 cols with short cells; code max 7 lines.`;

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

export async function downloadReferences(slug: string, urls: string[]): Promise<string[]> {
  const dir = path.join(postDir(slug), 'refs');
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
export async function planBook(slug: string, mode: 'topic' | 'references', input: string | string[]): Promise<Book> {
  if (mode === 'references') {
    const files = await downloadReferences(slug, input as string[]);
    return bookFromReferences(slug, files);
  }
  return bookFromTopic(slug, input as string);
}

/** Step 2: turn the approved book into slides — every point must be covered somewhere. */
export async function planSlidesFromBook(slug: string): Promise<Post> {
  const book = await loadBook(slug);
  if (!book) throw new Error('no book yet — generate the book first');
  const s = getSettings();
  const existing = await loadPost(slug).catch(() => null);

  const totalPoints = book.chapters.reduce((n, c) => n + c.points.length, 0);
  const prompt = [
    `You are the content designer for "${s.brand}", an Instagram account publishing tech handbooks as handwritten-notes carousels.`,
    'Here is the approved book (syllabus). EVERY point in it must be taught somewhere in the slides — nothing may be dropped:',
    JSON.stringify(book),
    `That is ${book.chapters.length} chapters and ${totalPoints} points. Choose the slide count that covers them all at full page density (up to ${MAX_SLIDES}); merge thin chapters or split heavy ones as needed, keeping the book's order.`,
    'Write original prose — teach each point concretely with real examples, tables and code, the way dense study notes do.',
    SCHEMA_RULES,
    envelope(s.brand, existing?.template ?? s.defaultTemplate, existing?.ratio ?? s.defaultRatio),
  ].join('\n\n');

  const post = await generate(prompt);
  await savePost(slug, post);
  return post;
}

/** Ask the AI to grow under-filled slides using the book, without touching the ones that fit. */
export async function densifySlides(
  slug: string,
  underfilled: { slide: number; fillPct: number }[]
): Promise<Post> {
  const post = await loadPost(slug);
  const book = await loadBook(slug);
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
