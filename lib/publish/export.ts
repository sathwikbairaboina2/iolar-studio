import { promises as fs } from 'fs';
import path from 'path';
import { publishedDir } from '@/lib/paths';
import { loadChapterMeta, loadSubject } from '@/lib/store';
import { loadBook } from '@/lib/ai/book';
import { iconSvg } from '@/lib/renderer/icons';
import { asChapterParts, editionHash, editionIconNames, editionWords, loadEdition, type Edition } from '@/lib/digital/edition';
import { parseHandbook, safeSvg, type Handbook } from './contract';
import { chapterHash } from './hash';
import { writeFileAtomic } from './atomic';
import { liveChapters, readState, updateState, type ChapterState } from './state';

const PASSES = ['rules', 'facts', 'pedagogy', 'readability'];

export function exportFile(subject: string) {
  return path.join(publishedDir(), `${subject}.handbook.json`);
}

/**
 * Whether the chapter's reviewed edition is still the one on disk and still matches the chapter's content.
 * The export includes a live chapter only then; the studio counts live chapters with the same test.
 */
export async function isChapterCurrent(subject: string, slug: string, cs: ChapterState | undefined, edition?: Edition | null): Promise<boolean> {
  if (!cs) return false;
  const hash = await chapterHash(subject, slug).catch(() => null);
  const e = edition === undefined ? await loadEdition(subject, slug) : edition;
  return !!hash && hash === cs.hash && !!e && e.inputsHash === hash && cs.editionHash === editionHash(e);
}

type Built = { handbook: Handbook | null; frozen: boolean; live: Map<string, string>; held: Set<string> };

const readPrevious = (subject: string) => fs.readFile(exportFile(subject), 'utf8').then((t) => JSON.parse(t) as Handbook).catch(() => null);

/**
 * The file as it should be now. `frozen` means the approved order does not cover what is live, so
 * the previous file stays until a person approves a new order. A chapter whose book.json or posts changed,
 * or whose edition is not the one that was reviewed, is left out until it is regenerated and reviewed again,
 * unless it is held (`keepLive`): then its previous entry stays, unchanged, until a person approves the correction.
 */
async function build(subject: string): Promise<Built> {
  const state = await readState(subject);
  const current = new Map<string, string>();
  const editions = new Map<string, Edition>();
  for (const slug of liveChapters(state)) {
    const edition = await loadEdition(subject, slug);
    const cs = state.chapters[slug];
    if (edition && (await isChapterCurrent(subject, slug, cs, edition))) {
      current.set(slug, cs.hash!);
      editions.set(slug, edition);
    }
  }
  const live = [...current.keys()];
  const held = new Set<string>();
  const heldEntries = new Map<string, Handbook['chapters'][number]>();
  let previous: Handbook | null = null;
  const wanted = Object.entries(state.chapters).filter(([slug, c]) => c.keepLive && c.selected && !c.rejected && !current.has(slug));
  if (wanted.length) {
    previous = await readPrevious(subject);
    for (const [slug] of wanted) {
      const entry = previous?.chapters.find((c) => c.slug === slug);
      if (entry) { held.add(slug); heldEntries.set(slug, entry); }
    }
  }
  if (!live.length && !held.size) return { handbook: null, frozen: false, live: current, held };
  const order = state.order;
  if (!order?.approvedBy || !live.every((s) => order.order.includes(s))) return { handbook: null, frozen: true, live: current, held };

  const slugs = [...order.order.filter((s) => live.includes(s) || held.has(s)), ...[...held].filter((s) => !order.order.includes(s))];
  const meta = await loadSubject(subject);
  const iconSources: string[] = [];
  const chapters: Handbook['chapters'] = [];
  for (const slug of slugs) {
    if (held.has(slug)) {
      const entry = heldEntries.get(slug)!;
      chapters.push({ ...entry, prerequisites: entry.prerequisites.filter((p) => slugs.includes(p)) });
      continue;
    }
    const cs = state.chapters[slug];
    const info = await loadChapterMeta(subject, slug);
    const book = await loadBook(subject, slug);
    const edition = editions.get(slug)!;
    iconSources.push(...editionIconNames(edition));
    chapters.push({
      slug,
      title: info.title,
      category: info.category,
      summary: book?.summary ?? '',
      prerequisites: (order.prerequisites[slug] ?? []).filter((p) => slugs.includes(p)),
      minutes: Math.max(1, Math.round(editionWords(edition) / 200)),
      hash: cs.hash!,
      review: { passedAt: cs.reviewedAt ?? new Date().toISOString(), passes: PASSES, approvedBy: cs.approvedBy! },
      parts: asChapterParts(edition) as Handbook['chapters'][number]['parts'],
    });
  }

  const logo = meta.slug.split('-')[0];
  const icons: Record<string, string> = {};
  for (const name of [...new Set([...iconSources, logo])]) {
    const svg = iconSvg(name);
    if (svg && safeSvg(svg)) icons[name] = svg;
  }
  // A held chapter keeps the icons it was published with.
  if (held.size) for (const [name, svg] of Object.entries(previous?.icons ?? {})) if (!icons[name] && safeSvg(svg)) icons[name] = svg;

  return {
    frozen: false,
    live: current,
    held,
    handbook: {
      schema: 1,
      slug: meta.slug,
      name: meta.name,
      emoji: meta.emoji ?? '',
      ...(icons[logo] ? { logo } : {}),
      description: meta.description ?? '',
      summary: '',
      updatedAt: new Date().toISOString(),
      order: slugs,
      orderReview: { confidence: order.confidence, approvedBy: order.approvedBy, gaps: order.gaps, overlaps: order.overlaps },
      icons,
      chapters,
    },
  };
}

export async function buildHandbook(subject: string): Promise<Handbook | null> {
  return (await build(subject)).handbook;
}

type Exported = { written: boolean; path: string; chapters: number };
const exports = new Map<string, Promise<unknown>>();

/** One export per subject at a time, so the publish job and a click in the studio never write the file together. */
export function exportSubject(subject: string): Promise<Exported> {
  const run = (exports.get(subject) ?? Promise.resolve()).catch(() => {}).then(() => exportNow(subject));
  exports.set(subject, run);
  return run;
}

/** Writes or deletes `published/<subject>.handbook.json`. An invalid file is never written; the contract's errors are thrown instead. */
async function exportNow(subject: string): Promise<Exported> {
  const file = exportFile(subject);
  const { handbook, frozen, live, held } = await build(subject);
  if (frozen) {
    // No new order yet, but a chapter that was unselected, rejected or edited must still leave the file.
    const previous = await readPrevious(subject);
    if (previous) {
      const keep = previous.chapters.filter((c) => live.get(c.slug) === c.hash || held.has(c.slug));
      if (keep.length !== previous.chapters.length) {
        const slugs = keep.map((c) => c.slug);
        const next: Handbook = { ...previous, updatedAt: new Date().toISOString(), order: previous.order.filter((s) => slugs.includes(s)), chapters: keep.map((c) => ({ ...c, prerequisites: c.prerequisites.filter((p) => slugs.includes(p)) })) };
        await writeFileAtomic(file, JSON.stringify(next, null, 2));
      }
    }
    return { written: false, path: file, chapters: 0 };
  }
  if (!handbook) {
    await fs.rm(file, { force: true });
    return { written: false, path: file, chapters: 0 };
  }
  const checked = parseHandbook(handbook);
  if (!checked.ok) throw new Error(`handbook is not valid: ${checked.errors.slice(0, 5).join('; ')}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify(handbook, null, 2));
  await updateState(subject, (s) => { s.exportedAt = handbook.updatedAt; });
  return { written: true, path: file, chapters: handbook.chapters.length };
}
