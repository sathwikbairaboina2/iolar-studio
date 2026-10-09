import { promises as fs } from 'fs';
import path from 'path';
import { publishedDir } from '@/lib/paths';
import { listParts, loadChapterMeta, loadPost, loadSubject } from '@/lib/store';
import { loadBook } from '@/lib/ai/book';
import { iconSvg } from '@/lib/renderer/icons';
import type { Post } from '@/lib/schema';
import { parseHandbook, safeSvg, type Handbook } from './contract';
import { chapterHash } from './hash';
import { iconNames } from './digital';
import { liveChapters, readState, writeState } from './state';

const PASSES = ['rules', 'facts', 'visual', 'pedagogy', 'brand', 'digital'];

export function exportFile(subject: string) {
  return path.join(publishedDir(), `${subject}.handbook.json`);
}

type Built = { handbook: Handbook | null; frozen: boolean; live: Map<string, string> };

/**
 * The file as it should be now. `frozen` means the approved order does not cover what is live, so
 * the previous file stays until a person approves a new order. Chapters edited after their review
 * are left out until they are reviewed again.
 */
async function build(subject: string): Promise<Built> {
  const state = await readState(subject);
  const current = new Map<string, string>();
  for (const slug of liveChapters(state)) {
    const hash = await chapterHash(subject, slug).catch(() => null);
    if (hash && hash === state.chapters[slug].hash) current.set(slug, hash);
  }
  const live = [...current.keys()];
  if (!live.length) return { handbook: null, frozen: false, live: current };
  const order = state.order;
  if (!order?.approvedBy || !live.every((s) => order.order.includes(s))) return { handbook: null, frozen: true, live: current };

  const slugs = order.order.filter((s) => live.includes(s));
  const meta = await loadSubject(subject);
  const allPosts: Post[] = [];
  const chapters: Handbook['chapters'] = [];
  for (const slug of slugs) {
    const cs = state.chapters[slug];
    const info = await loadChapterMeta(subject, slug);
    const book = await loadBook(subject, slug);
    const parts: Handbook['chapters'][number]['parts'] = [];
    let pages = 0;
    for (const n of await listParts(subject, slug)) {
      const post = await loadPost(subject, slug, n);
      allPosts.push(post);
      pages += post.slides.length;
      parts.push({
        n,
        title: `Part ${n}`,
        pages: post.slides.map((s) => ({
          title: s.page_title,
          blocks: s.blocks,
          ...(s.hero ? { hero: s.hero } : {}),
          ...(s.aside ? { aside: s.aside } : {}),
          ...(s.subtitle ? { subtitle: s.subtitle } : {}),
          ...(s.kind ? { kind: s.kind } : {}),
          ...(s.cover ? { cover: s.cover } : {}),
        })) as Handbook['chapters'][number]['parts'][number]['pages'],
      });
    }
    chapters.push({
      slug,
      title: info.title,
      category: info.category,
      summary: book?.summary ?? '',
      prerequisites: (order.prerequisites[slug] ?? []).filter((p) => slugs.includes(p)),
      minutes: Math.max(1, Math.round(pages * 1.1)),
      hash: cs.hash!,
      review: { passedAt: cs.reviewedAt ?? new Date().toISOString(), passes: PASSES, approvedBy: cs.approvedBy! },
      parts,
    });
  }

  const logo = meta.slug.split('-')[0];
  const icons: Record<string, string> = {};
  for (const name of [...iconNames(allPosts), logo]) {
    const svg = iconSvg(name);
    if (svg && safeSvg(svg)) icons[name] = svg;
  }

  return {
    frozen: false,
    live: current,
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

/** Writes or deletes `published/<subject>.handbook.json`. An invalid file is never written; the contract's errors are thrown instead. */
export async function exportSubject(subject: string): Promise<{ written: boolean; path: string; chapters: number }> {
  const file = exportFile(subject);
  const { handbook, frozen, live } = await build(subject);
  if (frozen) {
    // No new order yet, but a chapter that was unselected, rejected or edited must still leave the file.
    const previous = await fs.readFile(file, 'utf8').then((t) => JSON.parse(t) as Handbook).catch(() => null);
    if (previous) {
      const keep = previous.chapters.filter((c) => live.get(c.slug) === c.hash);
      if (keep.length !== previous.chapters.length) {
        const slugs = keep.map((c) => c.slug);
        const next: Handbook = { ...previous, updatedAt: new Date().toISOString(), order: previous.order.filter((s) => slugs.includes(s)), chapters: keep.map((c) => ({ ...c, prerequisites: c.prerequisites.filter((p) => slugs.includes(p)) })) };
        await fs.writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
        await fs.rename(`${file}.tmp`, file);
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
  await fs.writeFile(`${file}.tmp`, JSON.stringify(handbook, null, 2));
  await fs.rename(`${file}.tmp`, file);
  const state = await readState(subject);
  await writeState(subject, { ...state, exportedAt: handbook.updatedAt });
  return { written: true, path: file, chapters: handbook.chapters.length };
}
