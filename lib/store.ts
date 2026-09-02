import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost } from './schema';
import { getSettings } from './settings';
import {
  bookFile, chapterDir, chapterFile, handbooksRoot, partDir, partsDir, postFile,
  rendersDir, exportDir, subjectDir, subjectFile,
} from './paths';

export type Subject = { slug: string; name: string; emoji: string; description: string };
export type SubjectMeta = Subject & { chapters: number; pages: number };
export type ChapterMeta = {
  subject: string;
  slug: string;
  title: string;
  parts: number;
  points: number;
  pages: number;
  avgFill: number;
  status: string;
  updatedAt: string;
};

const DEFAULT_EMOJI: Record<string, string> = {
  python: '🐍', sql: '🗄️', dsa: '🧠', 'system-design': '⚙️', misc: '📓',
};

function titleCase(slug: string) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) as T; } catch { return null; }
}

/* ── subjects ─────────────────────────────────────────── */

export async function createSubject(slug: string, init: Partial<Subject> = {}): Promise<Subject> {
  const subject: Subject = {
    slug,
    name: init.name ?? titleCase(slug),
    emoji: init.emoji ?? DEFAULT_EMOJI[slug] ?? '📓',
    description: init.description ?? '',
  };
  await fs.mkdir(subjectDir(slug), { recursive: true });
  await fs.writeFile(subjectFile(slug), JSON.stringify(subject, null, 2));
  try {
    (await import('./handbookIndex')).indexSubject(subject);
    const { syncSubject } = await import('./knowledge/spaces/handbooks');
    await syncSubject(subject);
  } catch (err) {
    console.warn('[instastudio] subject index failed', err);
  }
  return subject;
}

export async function loadSubject(slug: string): Promise<Subject> {
  const s = await readJson<Subject>(subjectFile(slug));
  if (!s) throw new Error(`subject not found: ${slug}`);
  return s;
}

export async function listSubjects(): Promise<SubjectMeta[]> {
  await fs.mkdir(handbooksRoot(), { recursive: true });
  const out: SubjectMeta[] = [];
  for (const slug of await fs.readdir(handbooksRoot())) {
    const s = await readJson<Subject>(subjectFile(slug));
    if (!s) continue;
    const chapters = await listChapters(slug);
    out.push({
      ...s,
      chapters: chapters.length,
      pages: chapters.reduce((n, c) => n + c.pages, 0),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── chapters ─────────────────────────────────────────── */

export async function createChapter(subject: string, slug: string, title?: string): Promise<ChapterMeta> {
  await fs.mkdir(chapterDir(subject, slug), { recursive: true });
  await fs.writeFile(
    chapterFile(subject, slug),
    JSON.stringify({ title: title ?? titleCase(slug), created: new Date().toISOString() }, null, 2)
  );
  const s = getSettings();
  await createPart(subject, slug, 1, validatePost({
    brand: s.brand,
    template: s.defaultTemplate,
    ratio: s.defaultRatio,
    seed: 42,
    series: (title ?? titleCase(slug)).toUpperCase(),
    date: new Date().toLocaleDateString('en-GB'),
    slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'New chapter' }] }],
    caption: { text: '', hashtags: [] },
  }));
  return loadChapterMeta(subject, slug);
}

export async function loadChapterMeta(subject: string, chapter: string): Promise<ChapterMeta> {
  const meta = await readJson<{ title: string }>(chapterFile(subject, chapter));
  const parts = await listParts(subject, chapter);
  const book = await readJson<{ chapters: { points: string[] }[] }>(bookFile(subject, chapter));

  let pages = 0;
  let fillSum = 0;
  let fillCount = 0;
  for (const part of parts) {
    const report = await readJson<Record<string, { fillPct?: number }>>(
      path.join(rendersDir(subject, chapter, part), 'render-report.json')
    );
    if (!report) continue;
    for (const entry of Object.values(report)) {
      pages += 1;
      if (typeof entry.fillPct === 'number') { fillSum += entry.fillPct; fillCount += 1; }
    }
  }

  const statuses = await Promise.all(parts.map((p) => partStatus(subject, chapter, p)));
  const rank = ['draft', 'rendered', 'polished', 'packaged'];
  const status = statuses.length
    ? statuses.reduce((a, b) => (rank.indexOf(b) < rank.indexOf(a) ? b : a), 'packaged')
    : 'draft';

  let updatedAt = new Date(0).toISOString();
  for (const part of parts) {
    try {
      const st = await fs.stat(postFile(subject, chapter, part));
      if (st.mtime.toISOString() > updatedAt) updatedAt = st.mtime.toISOString();
    } catch { /* part without a post */ }
  }

  return {
    subject,
    slug: chapter,
    title: meta?.title ?? titleCase(chapter),
    parts: parts.length,
    points: book ? book.chapters.reduce((n, c) => n + c.points.length, 0) : 0,
    pages,
    avgFill: fillCount ? Math.round(fillSum / fillCount) : 0,
    status,
    updatedAt,
  };
}

export async function listChapters(subject: string): Promise<ChapterMeta[]> {
  const dir = subjectDir(subject);
  if (!(await exists(dir))) return [];
  const out: ChapterMeta[] = [];
  for (const entry of await fs.readdir(dir)) {
    if (entry === 'subject.json') continue;
    if (!(await exists(chapterFile(subject, entry)))) continue;
    out.push(await loadChapterMeta(subject, entry));
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/* ── parts ────────────────────────────────────────────── */

export async function listParts(subject: string, chapter: string): Promise<number[]> {
  try {
    return (await fs.readdir(partsDir(subject, chapter)))
      .map((d) => Number(d))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function nextPartNumber(subject: string, chapter: string): Promise<number> {
  const parts = await listParts(subject, chapter);
  return parts.length ? Math.max(...parts) + 1 : 1;
}

export async function createPart(subject: string, chapter: string, part: number, post: Post): Promise<Post> {
  const valid = validatePost(post);
  await fs.mkdir(partDir(subject, chapter, part), { recursive: true });
  await fs.writeFile(postFile(subject, chapter, part), JSON.stringify(valid, null, 2));
  await indexChapter(subject, chapter, valid);
  return valid;
}

export async function loadPost(subject: string, chapter: string, part: number): Promise<Post> {
  return validatePost(JSON.parse(await fs.readFile(postFile(subject, chapter, part), 'utf8')));
}

export async function savePost(subject: string, chapter: string, part: number, post: Post): Promise<void> {
  const valid = validatePost(post);
  await fs.mkdir(partDir(subject, chapter, part), { recursive: true });
  await fs.writeFile(postFile(subject, chapter, part), JSON.stringify(valid, null, 2));
  await indexChapter(subject, chapter, valid);
}

export async function partStatus(
  subject: string, chapter: string, part: number
): Promise<'draft' | 'rendered' | 'polished' | 'packaged'> {
  if (await exists(exportDir(subject, chapter, part))) return 'packaged';
  if (await exists(path.join(rendersDir(subject, chapter, part), 'polished'))) return 'polished';
  if (await exists(rendersDir(subject, chapter, part))) return 'rendered';
  return 'draft';
}

/** Mirrors content into SQLite + the knowledge graph. Never fails a save. */
async function indexChapter(subject: string, chapter: string, post: Post) {
  try {
    (await import('./handbookIndex')).indexChapter(subject, chapter, post, 'draft');
    const { syncChapter } = await import('./knowledge/spaces/handbooks');
    await syncChapter(subject, chapter, post, 'draft');
  } catch (err) {
    console.warn('[instastudio] index failed for', subject, chapter, err);
  }
}
