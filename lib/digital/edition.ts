import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { digitalDir } from '@/lib/paths';
import { chapterHash } from '@/lib/publish/hash';
import { parseHandbook } from '@/lib/publish/contract';

export type EditionPage = { title: string; blocks: unknown[] };
export type EditionSection = { title: string; role: 'intro' | 'outline' | 'quiz'; outlineIndex?: number; pages: EditionPage[] };
export type Edition = { schema: 1; subject: string; chapter: string; inputsHash: string; generatedAt: string; sections: EditionSection[] };

/** Limits a generated edition has to stay inside; the gates run every example, so size is time. */
export const MAX_PAGES_PER_SECTION = 6;
export const MAX_CODE_BLOCKS_PER_SECTION = 12;
export const MAX_CODE_BLOCKS_PER_EDITION = 160;
export const MAX_EDITION_BYTES = 1_500_000;

/** Code blocks that are examples; an output block only shows what the example before it prints. */
const exampleCount = (s: EditionSection) =>
  s.pages.reduce((n, p) => n + p.blocks.filter((b) => (b as { type?: string; lang?: string })?.type === 'code' && (b as { lang?: string }).lang !== 'output').length, 0);

export function editionFile(s: string, c: string) {
  return path.join(digitalDir(s, c), 'edition.json');
}

/** Changes whenever book.json or any part's post.json changes; the edition is regenerated only then. */
export function inputsHash(subject: string, chapter: string): Promise<string> {
  return chapterHash(subject, chapter);
}

export function editionHash(e: Edition): string {
  return createHash('sha256').update(JSON.stringify(e.sections)).digest('hex');
}

/** Each section becomes one part of the published chapter. */
export function asChapterParts(e: Edition): { n: number; title: string; pages: { title: string; blocks: unknown[] }[] }[] {
  return e.sections.map((s, i) => ({ n: i + 1, title: s.title, pages: s.pages.map((p) => ({ title: p.title, blocks: p.blocks })) }));
}

/** The edition as the site would read it: wrapped in a one-chapter handbook and run through the contract. */
export function validateEdition(e: Edition, title: string): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!e.sections.length) errors.push('the edition has no sections');
  e.sections.forEach((s) => {
    if (!s.pages.length) errors.push(`section "${s.title}" has no pages`);
    s.pages.forEach((p) => { if (!p.blocks.length) errors.push(`page "${p.title}" in "${s.title}" has no blocks`); });
  });
  e.sections.forEach((s) => {
    if (s.pages.length > MAX_PAGES_PER_SECTION) errors.push(`section "${s.title}" has ${s.pages.length} pages; the most allowed is ${MAX_PAGES_PER_SECTION}`);
    const code = exampleCount(s);
    if (code > MAX_CODE_BLOCKS_PER_SECTION) errors.push(`section "${s.title}" has ${code} code blocks; the most allowed is ${MAX_CODE_BLOCKS_PER_SECTION}`);
  });
  const total = e.sections.reduce((n, s) => n + exampleCount(s), 0);
  if (total > MAX_CODE_BLOCKS_PER_EDITION) errors.push(`the edition has ${total} code blocks; the most allowed is ${MAX_CODE_BLOCKS_PER_EDITION}`);
  const bytes = Buffer.byteLength(JSON.stringify(e.sections));
  if (bytes > MAX_EDITION_BYTES) errors.push(`the edition is ${bytes} bytes; the most allowed is ${MAX_EDITION_BYTES}`);
  if (errors.length) return { ok: false, errors };
  const checked = parseHandbook({
    schema: 1, slug: e.subject, name: e.subject, description: '', updatedAt: e.generatedAt, order: [e.chapter],
    orderReview: { confidence: 0, approvedBy: 'dev', gaps: [], overlaps: [] },
    icons: {},
    chapters: [{
      slug: e.chapter, title: title || e.chapter, category: 'handbook', summary: '', prerequisites: [], minutes: 1, hash: 'x',
      review: { passedAt: e.generatedAt, passes: [], approvedBy: 'dev' }, parts: asChapterParts(e),
    }],
  });
  return checked.ok ? { ok: true } : { ok: false, errors: checked.errors };
}

export async function loadEdition(s: string, c: string): Promise<Edition | null> {
  try {
    return JSON.parse(await fs.readFile(editionFile(s, c), 'utf8')) as Edition;
  } catch {
    return null;
  }
}

/** Validates first, then writes through a temp file, so a bad edition never reaches the disk. */
export async function saveEdition(e: Edition): Promise<void> {
  const v = validateEdition(e, e.chapter);
  if (!v.ok) throw new Error(`edition is not valid: ${v.errors.slice(0, 5).join('; ')}`);
  const file = editionFile(e.subject, e.chapter);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(e, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Every icon name an edition uses: icon fields and {icon:name} in any text. */
export function editionIconNames(e: Edition): string[] {
  const names = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{icon:([^{}\n]+?)\}/g)) names.add(m[1].trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'icon' && typeof x === 'string') names.add(x.trim());
        else walk(x);
      }
    }
  };
  for (const s of e.sections) walk(s.pages);
  names.delete('');
  return [...names];
}

const NON_PROSE = new Set(['type', 'kind', 'style', 'ink', 'icon', 'lang', 'frame', 'shape']);
/** Words in all of the edition's text (code included), for a reading time. */
export function editionWords(e: Edition): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (typeof v === 'string') n += v.split(/\s+/).filter(Boolean).length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!NON_PROSE.has(k)) walk(x);
  };
  for (const s of e.sections) walk(s.pages);
  return n;
}
