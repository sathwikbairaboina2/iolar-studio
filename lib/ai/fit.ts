import path from 'path';
import { tmpdir } from 'os';
import { Post, validatePost } from '../schema';
import { loadPost } from '../store';
import { renderSlide, mergeContinuations } from '../renderer/capture';
import { stripInline } from '../renderer/inline';
import { SCHEMA_RULES, PRESERVE_RULE } from './rules';
import { Book, loadBook } from './book';
import { thinker } from './runner';
import { extractJson } from './revise';

export type SlideFit = { slide: number; neededPct: number };

const STOP = new Set(
  ('the a an and or of to in for with is are was were be been being its it you your his her their our'
   + ' how what why when where which who whom use uses used using vs versus on at by as that this these those'
   + ' from can could will would should may might must not no nor but if then than so such too very just'
   + ' into onto over under above below between both each all any some more most other same only own now'
   + ' do does did done get gets got make makes made take takes has have had here there while during after'
   + ' before because about across through against per via out up down off again once ever never always'
   + ' one two three first second next last also e.g eg ie i.e etc'
  ).split(' ')
);

/**
 * Words as the matcher compares them. Both the book point and the page text go through this,
 * so `arr.push` and "arr.push" reduce to the same two tokens. Comparing a stripped keyword
 * against unstripped page text — which is what this used to do — made every identifier
 * containing a dot or bracket permanently unmatchable.
 */
function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** Crude suffix stripping so "evicting", "evicted" and "eviction" all count as the same word. */
function stem(w: string): string {
  for (const [suffix, min] of [['ation', 7], ['ing', 6], ['ed', 5], ['es', 5], ['ly', 5]] as const) {
    if (w.length >= min && w.endsWith(suffix)) return trimE(w.slice(0, -suffix.length));
  }
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) return trimE(w.slice(0, -1));
  return trimE(w);
}

/** "mutating" stems to "mutat", so "mutate" has to as well or the two never meet. */
function trimE(w: string): string {
  return w.length >= 5 && w.endsWith('e') ? w.slice(0, -1) : w;
}

function useful(w: string): boolean {
  return w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);
}

function terms(s: string): string[] {
  return tokens(s).filter(useful).map(stem);
}

/**
 * How many of the book's points each word appears in, and how many points there are. A word
 * used all over the book ("state", "pod") says little about whether one specific point
 * survived; a rare one ("besteffort") says almost everything.
 */
function documentFrequency(book: Book): { df: Map<string, number>; points: number } {
  const df = new Map<string, number>();
  let points = 0;
  for (const ch of book.chapters) {
    for (const p of ch.points) {
      points++;
      for (const w of new Set(terms(p))) df.set(w, (df.get(w) ?? 0) + 1);
    }
  }
  return { df, points };
}

/**
 * Share of a point's meaning that survives in the page text, weighting each word by how rare it
 * is in the book. Every word counts — taking only the rarest few made incidental wording decide
 * the verdict — but a distinctive term is worth many common ones.
 */
function coverageScore(point: string, body: Set<string>, df: Map<string, number>, points: number): number | null {
  const words = [...new Set(terms(point))];
  if (!words.length) return null;
  let total = 0;
  let found = 0;
  for (const w of words) {
    const weight = Math.log(1 + points / (1 + (df.get(w) ?? 0)));
    total += weight;
    if (body.has(w)) found += weight;
  }
  return total > 0 ? found / total : null;
}

/**
 * Below this share of a point's weighted vocabulary, the point is treated as no longer taught.
 * Measured over the whole library against the pages as they stand: 0.42 flags 9 points in 4016
 * where the previous rule flagged 32, and still catches more genuine removals than it did.
 */
const COVERED = 0.42;

function stringsIn(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringsIn);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(stringsIn);
  return [];
}

function postText(post: Post): string {
  const parts: string[] = [];
  for (const s of post.slides) {
    parts.push(s.page_title);
    for (const b of s.blocks) {
      if ('text' in b) parts.push(b.text);
      if ('title' in b) parts.push(b.title);
      if ('q' in b) parts.push(b.q);
      if ('items' in b) parts.push(...b.items);
      if ('lines' in b) parts.push(...b.lines);
      if ('a_bullets' in b) parts.push(...b.a_bullets);
      if ('example_code' in b && b.example_code) parts.push(...b.example_code);
      if (b.type === 'table') {
        parts.push(...b.headers);
        for (const row of b.rows) parts.push(...row);
      }
      // Diagrams teach too: every string inside a spec counts (card text, chain notes, schema columns, node labels).
      if (b.type === 'diagram') parts.push(...stringsIn(b.spec));
    }
  }
  return stripInline(parts.join(' ')).toLowerCase();
}

/** Book points whose keywords no longer appear in the post — i.e. content that was dropped. */
export function uncoveredPoints(book: Book, post: Post): string[] {
  const body = new Set(terms(postText(post)));
  const { df, points } = documentFrequency(book);
  const missing: string[] = [];
  for (const ch of book.chapters) {
    for (const p of ch.points) {
      const score = coverageScore(p, body, df, points);
      if (score !== null && score < COVERED) missing.push(p);
    }
  }
  return missing;
}

/**
 * The page that teaches most of one book section, so a search hit can land on it. A section's
 * pages carry no back-reference to it, and spills and polish move content between parts, so it
 * is found the same way coverage is: by which slide's words its points survive in.
 */
export function locateSection(
  book: Book,
  section: number,
  parts: { part: number; post: Post }[]
): { part: number; page: number } | null {
  const points = book.chapters[section]?.points ?? [];
  if (!points.length) return null;
  const { df, points: n } = documentFrequency(book);
  let best = { part: 0, page: 0, score: 0 };
  for (const { part, post } of parts) {
    for (let i = 0; i < post.slides.length; i++) {
      const body = new Set(terms(postText({ ...post, slides: [post.slides[i]] })));
      const score = points.reduce((sum, p) => sum + (coverageScore(p, body, df, n) ?? 0), 0);
      if (score > best.score) best = { part, page: i + 1, score };
    }
  }
  return best.score > 0 ? { part: best.part, page: best.page } : null;
}

/** How much of one page each authored slide needs. Over 100% spills onto the next page. */
export async function measureSlides(post: Post): Promise<SlideFit[]> {
  const out: SlideFit[] = [];
  // Measurement renders are throwaway: keep them out of the content tree.
  const dir = path.join(tmpdir(), 'instastudio-measure');
  for (let i = 0; i < post.slides.length; i++) {
    const r = await renderSlide(post, i, path.join(dir, `m-${i}.png`));
    out.push({ slide: i + 1, neededPct: r.neededPct });
  }
  return out;
}

/**
 * Fills thin pages toward ~95% by pulling MORE material from the book. It never trims:
 * a proposal that drops any book point is rejected. Over-full pages are left alone —
 * the renderer spills them onto the next page, and content that runs past the carousel
 * belongs in a follow-up post, not in the bin.
 */
export async function fitToPages(
  subject: string, chapter: string, part: number
): Promise<{ proposal: Post; before: SlideFit[] }> {
  const post = { ...(await loadPost(subject, chapter, part)) };
  post.slides = mergeContinuations(post.slides);

  const before = await measureSlides(post);
  const book = await loadBook(subject, chapter);
  const under = before.filter((m) => m.neededPct < 92);
  if (!under.length) return { proposal: post, before };

  const prompt = [
    'You are filling out a handwritten-notes carousel so every page is nearly full.',
    'The pages were rendered and measured. Target 92-98% of one page each.',
    `These pages leave space empty — add genuinely useful material until each reaches about 95%: another numbered section, more table rows, a worked example, a tip callout:\n${under
      .map((m) => `- slide ${m.slide}: fills only ${m.neededPct}% of a page`)
      .join('\n')}`,
    'NEVER remove or shorten existing content. Every fact, bullet, table row and code line that is already there must survive verbatim. You may only ADD.',
    'Do not change the number of slides. Keep the numbered section structure and the study-notes voice.',
    'New blocks stay short: bullets one line each, table cells 1-3 words, code lines under 60 characters.',
    PRESERVE_RULE,
    book ? `Draw the added material from this book (syllabus), preferring points that are currently thin:\n${JSON.stringify(book)}` : '',
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
    'Schema and vocabulary:',
    SCHEMA_RULES,
  ].filter(Boolean).join('\n\n');

  const out = await thinker()(prompt, { timeoutMs: 900_000 });
  const proposal = validatePost(extractJson(out));

  if (proposal.slides.length !== post.slides.length) {
    throw new Error('fit pass changed the slide count — rejected');
  }

  // The fit pass may only ADD. Counting blocks catches deletions that a keyword check
  // misses, because dropped material often shares vocabulary with what survives.
  const blocksBefore = post.slides.reduce((n, s) => n + s.blocks.length, 0);
  const blocksAfter = proposal.slides.reduce((n, s) => n + s.blocks.length, 0);
  if (blocksAfter < blocksBefore) {
    throw new Error(
      `fit pass removed content (${blocksBefore} blocks -> ${blocksAfter}) — rejected; it may only add`
    );
  }
  if (book) {
    // Hard gate: the fit pass may only add. Anything the book covered must still be covered.
    const lostNow = uncoveredPoints(book, proposal);
    const lostBefore = uncoveredPoints(book, post);
    const dropped = lostNow.filter((p) => !lostBefore.includes(p));
    if (dropped.length) {
      throw new Error(
        `fit pass dropped ${dropped.length} book point(s) — rejected. First: ${dropped[0].slice(0, 80)}`
      );
    }
  }
  return { proposal, before };
}
