import { loadBook } from '@/lib/ai/book';
import { runClaude } from '@/lib/ai/claude';
import { extractJson } from '@/lib/ai/revise';
import { listParts, loadChapterMeta, loadPost } from '@/lib/store';
import type { Post } from '@/lib/schema';
import { inputsHash, saveEdition, validateEdition, type Edition, type EditionPage, type EditionSection } from './edition';
import { carouselText, sectionPrompt } from './prompt';

export type SectionRequest = { role: 'intro' | 'outline' | 'quiz'; outlineIndex?: number; notes?: string[] };

const PARALLEL = 3;

async function context(subject: string, chapter: string) {
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('the chapter has no book.json to write the edition from');
  const posts: Post[] = [];
  for (const n of await listParts(subject, chapter)) posts.push(await loadPost(subject, chapter, n));
  const meta = await loadChapterMeta(subject, chapter);
  return { book, chapterTitle: meta.title || book.title, carousel: carouselText(posts) };
}

type Ctx = Awaited<ReturnType<typeof context>>;

function fallbackTitle(book: Ctx['book'], req: SectionRequest) {
  return req.role === 'intro' ? 'Introduction' : req.role === 'quiz' ? 'Check yourself' : book.chapters[req.outlineIndex ?? 0]?.title ?? 'Section';
}

/** One model call, retried once with the validation errors. A runClaude failure (Claude missing) is not retried. */
async function writeSection(subject: string, chapter: string, ctx: Ctx, req: SectionRequest): Promise<EditionSection> {
  let error: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = sectionPrompt({ ...ctx, role: req.role, outlineIndex: req.outlineIndex, notes: req.notes, error });
    const raw = await runClaude(prompt, { timeoutMs: 300_000 });
    try {
      const parsed = extractJson(raw) as { title?: unknown; pages?: unknown };
      if (!Array.isArray(parsed.pages)) throw new Error('the answer has no "pages" array');
      const pages = parsed.pages as EditionPage[];
      for (const p of pages) {
        if (typeof p?.title !== 'string' || !Array.isArray(p.blocks)) throw new Error('every page needs a "title" and a "blocks" array');
      }
      const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle(ctx.book, req);
      const section: EditionSection = { title, role: req.role, ...(req.role === 'outline' ? { outlineIndex: req.outlineIndex } : {}), pages };
      const one: Edition = { schema: 1, subject, chapter, inputsHash: '', generatedAt: new Date().toISOString(), sections: [section] };
      const v = validateEdition(one, ctx.chapterTitle);
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

/** Intro, one section per book.json section, then quiz and summary. Nothing is saved unless every section is valid. */
export async function generateEdition(subject: string, chapter: string, opts: { notes?: Record<number, string[]> } = {}): Promise<Edition> {
  const hash = await inputsHash(subject, chapter);
  const ctx = await context(subject, chapter);
  const requests: SectionRequest[] = [
    { role: 'intro' },
    ...ctx.book.chapters.map((_, i): SectionRequest => ({ role: 'outline', outlineIndex: i, notes: opts.notes?.[i] })),
    { role: 'quiz' },
  ];
  const sections: EditionSection[] = new Array(requests.length);
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (!failure) {
      const i = next++;
      if (i >= requests.length) return;
      try {
        sections[i] = await writeSection(subject, chapter, ctx, requests[i]);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, requests.length) }, worker));
  if (failure) throw failure;

  const edition: Edition = { schema: 1, subject, chapter, inputsHash: hash, generatedAt: new Date().toISOString(), sections };
  await saveEdition(edition);
  return edition;
}
