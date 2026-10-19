import { datasetRules, loadBook } from '@/lib/ai/book';
import { runClaude } from '@/lib/ai/claude';
import { extractJson } from '@/lib/ai/revise';
import { categoryOf, isLabelCover } from '@/lib/handbookCategories';
import { listParts, loadChapterMeta, loadPost } from '@/lib/store';
import type { Post } from '@/lib/schema';
import { inputsHash, loadEdition, saveEdition, validateEdition, type Edition, type EditionPage, type EditionSection } from './edition';
import { carouselFor, sectionPrompt } from './prompt';

export type SectionRequest = { role: 'intro' | 'outline' | 'quiz'; outlineIndex?: number; notes?: string[] };

const PARALLEL = 3;

/** Model calls per section; the last one may drop a diagram the contract rejects. */
const ATTEMPTS = 3;

async function context(subject: string, chapter: string) {
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('the chapter has no book.json to write the edition from');
  const posts: Post[] = [];
  for (const n of await listParts(subject, chapter)) posts.push(await loadPost(subject, chapter, n));
  const meta = await loadChapterMeta(subject, chapter);
  return { book, chapterTitle: meta.title || book.title, posts, category: categoryOf(meta.category) };
}

type Ctx = Awaited<ReturnType<typeof context>>;

const DIAGRAM_KINDS = new Set(['flow', 'chain', 'flowchart', 'cards', 'array', 'matrix', 'tables', 'schema', 'er']);

/** The first complete JSON object in an answer, even when prose or a second object follows it. */
export function firstJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('no JSON object in the answer');
  let depth = 0;
  let inString = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error('the JSON object in the answer is not closed');
}

function parseAnswer(raw: string): unknown {
  try {
    return extractJson(raw);
  } catch {
    return firstJsonObject(raw);
  }
}

/** A diagram written as {"type":"flow", ...} instead of {"type":"diagram","kind":"flow","spec":{...}} is the same diagram. */
export function normalizeBlock(block: unknown): unknown {
  const b = block as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || typeof b.type !== 'string' || !DIAGRAM_KINDS.has(b.type)) return block;
  const { type, spec, ...rest } = b;
  return { type: 'diagram', kind: type, spec: spec ?? rest };
}

function fallbackTitle(book: Ctx['book'], req: SectionRequest) {
  return req.role === 'intro' ? 'Introduction' : req.role === 'quiz' ? 'Check yourself' : book.chapters[req.outlineIndex ?? 0]?.title ?? 'Section';
}

/** The section without the diagram blocks that fail validation on a page of their own. */
function withoutInvalidDiagrams(section: EditionSection, valid: (s: EditionSection) => boolean): EditionSection {
  const alone = (block: unknown): EditionSection => ({ ...section, pages: [{ title: 'diagram', blocks: [block] }] });
  const pages = section.pages.map((p) => ({ ...p, blocks: p.blocks.filter((b) => (b as { type?: string })?.type !== 'diagram' || valid(alone(b))) }));
  return { ...section, pages };
}

/** One model call, retried (up to ATTEMPTS in all) with the validation errors. A runClaude failure (Claude missing) is not retried. */
async function writeSection(subject: string, chapter: string, ctx: Ctx, req: SectionRequest): Promise<EditionSection> {
  let error: string | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const section = req.role === 'outline' ? ctx.book.chapters[req.outlineIndex ?? 0] : undefined;
    const carousel = carouselFor(ctx.posts, section);
    const dataset = datasetRules(ctx.book, ctx.category.id) || undefined;
    const prompt = sectionPrompt({ book: ctx.book, chapterTitle: ctx.chapterTitle, carousel, category: ctx.category, shape: section?.shape?.filter((r) => r !== 'cover'), dataset, role: req.role, outlineIndex: req.outlineIndex, notes: req.notes, error });
    const raw = await runClaude(prompt, { timeoutMs: 300_000 });
    try {
      const parsed = parseAnswer(raw) as { title?: unknown; pages?: unknown };
      if (!Array.isArray(parsed.pages)) throw new Error('the answer has no "pages" array');
      const pages = parsed.pages as EditionPage[];
      for (const p of pages) {
        if (typeof p?.title !== 'string' || !Array.isArray(p.blocks)) throw new Error('every page needs a "title" and a "blocks" array');
      }
      for (const p of pages) p.blocks = p.blocks.map(normalizeBlock);
      // An outline section keeps the book's title; the quiz is always "Check yourself". The one page carries the same title.
      const title = req.role === 'intro' && typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle(ctx.book, req);
      if (pages.length === 1 && req.role !== 'intro') pages[0].title = title;
      if (req.role === 'quiz') {
        if (pages.length !== 1) throw new Error(`the quiz section has ${pages.length} pages; it has exactly 1 page of 3 to 5 qa blocks`);
        const questions = pages[0].blocks.filter((b) => (b as { type?: string })?.type === 'qa').length;
        if (questions < 3 || questions > 5) throw new Error(`the quiz page has ${questions} qa blocks; it needs 3 to 5 qa blocks`);
      }
      let section: EditionSection = { title, role: req.role, ...(req.role === 'outline' ? { outlineIndex: req.outlineIndex } : {}), pages };
      const check = (sec: EditionSection) => validateEdition({ schema: 1, subject, chapter, category: ctx.category.id, inputsHash: '', generatedAt: new Date().toISOString(), sections: [sec] }, ctx.chapterTitle, { fresh: true });
      let v = check(section);
      // One diagram the contract rejects twice is not worth losing the chapter over; the page keeps its other notes.
      if (!v.ok && attempt === ATTEMPTS - 1) {
        section = withoutInvalidDiagrams(section, (sec) => check(sec).ok);
        v = check(section);
      }
      if (!v.ok) throw new Error(v.errors.slice(0, 6).join('; '));
      return section;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`section ${fallbackTitle(ctx.book, req)}: ${error}`);
}

export async function generateSection(subject: string, chapter: string, req: SectionRequest): Promise<EditionSection> {
  return writeSection(subject, chapter, await context(subject, chapter), req);
}

/** The "Q<n>." a model writes at the start of a question, however it spaces or closes it ("Q12)", "Q 12."). */
const QUESTION_NUMBER = /^Q\s?\d+\s?[.)]\s*/;

/** Q&A banks and drills number their items across the whole edition, but the model writes one section at a time. */
export function renumberQuestions(sections: EditionSection[]): EditionSection[] {
  let n = 0;
  const renumber = (text: string) => (QUESTION_NUMBER.test(text) ? `Q${++n}. ${text.replace(QUESTION_NUMBER, '')}` : text);
  return sections.map((s) => {
    if (s.role !== 'outline') return s;
    const pages = s.pages.map((p) => ({
      ...p,
      blocks: p.blocks.map((b) => {
        const block = b as { type?: string; q?: unknown; text?: unknown };
        if (block.type === 'qa' && typeof block.q === 'string') return { ...block, q: renumber(block.q) };
        if (block.type === 'heading' && typeof block.text === 'string') return { ...block, text: renumber(block.text) };
        return b;
      }),
    })) as EditionPage[];
    return { ...s, pages };
  });
}

const numbered = (ctx: Ctx, sections: EditionSection[]) => (ctx.category.presentation.numbering === 'continuous' ? renumberQuestions(sections) : sections);

/** Book sections that become edition sections: a cover of short labels only lists what is inside, so it has no page of its own; a cover that teaches does. */
const writable = (book: Ctx['book']) => book.chapters.flatMap((c, i) => (isLabelCover(c) ? [] : [i]));

/** Runs the jobs three at a time, keeps their order, and stops starting new ones after the first failure. */
async function inPool<T, R>(items: T[], job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (!failure) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await job(items[i]);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  if (failure) throw failure;
  return out;
}

/** One page per book.json section, then the quiz page. Nothing is saved unless every section is valid. */
export async function generateEdition(subject: string, chapter: string, opts: { notes?: Record<number, string[]> } = {}): Promise<Edition> {
  const hash = await inputsHash(subject, chapter);
  const ctx = await context(subject, chapter);
  const requests: SectionRequest[] = [
    ...writable(ctx.book).map((i): SectionRequest => ({ role: 'outline', outlineIndex: i, notes: opts.notes?.[i] })),
    { role: 'quiz' },
  ];
  const sections = numbered(ctx, await inPool(requests, (r) => writeSection(subject, chapter, ctx, r)));

  const edition: Edition = { schema: 1, subject, chapter, category: ctx.category.id, inputsHash: hash, generatedAt: new Date().toISOString(), sections };
  await saveEdition(edition);
  return edition;
}

/**
 * Writes the sections the notes name (by title) again with the notes, or every outline section when none is
 * named. Without an edition yet, writes a whole one with the notes on every outline section.
 */
export async function regenerateWithNotes(subject: string, chapter: string, notes: string): Promise<Edition> {
  const ctx = await context(subject, chapter);
  const edition = await loadEdition(subject, chapter);
  const outline = edition?.sections.filter((s) => s.role === 'outline').length ?? 0;
  const hash = await inputsHash(subject, chapter);
  // Sections written from older inputs cannot be patched into an edition stamped with the new hash.
  // An edition from before the revision-note shape (an intro, or an outline section of several pages) is written again whole.
  const oldShape = !!edition && edition.sections.some((s) => s.role === 'intro' || (s.role === 'outline' && s.pages.length !== 1));
  if (!edition || oldShape || outline !== writable(ctx.book).length || edition.inputsHash !== hash) {
    return generateEdition(subject, chapter, { notes: Object.fromEntries(writable(ctx.book).map((i) => [i, [notes]])) });
  }
  const low = notes.toLowerCase();
  const named = edition.sections.flatMap((s, i) => (low.includes(s.title.toLowerCase()) ? [i] : []));
  const targets = named.length ? named : edition.sections.flatMap((s, i) => (s.role === 'outline' ? [i] : []));
  const written = await inPool(targets, (i) => writeSection(subject, chapter, ctx, { role: edition.sections[i].role, outlineIndex: edition.sections[i].outlineIndex, notes: [notes] }));
  const sections = [...edition.sections];
  targets.forEach((si, k) => { sections[si] = written[k]; });
  const next: Edition = { ...edition, category: ctx.category.id, inputsHash: hash, generatedAt: new Date().toISOString(), sections: numbered(ctx, sections) };
  await saveEdition(next);
  return next;
}
