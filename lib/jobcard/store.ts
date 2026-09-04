import { promises as fs } from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { jobcardDir, jobcardFile, jobcardImage } from '@/lib/paths';
import { Family, JobCard, JobCardDraft, missingMandatory, parseJobCard } from './schema';

/**
 * Where a card lives. The document is a file under `data/jobcard/<id>/`, the way a post
 * or a reel is; the `jobcards` row is the index the page lists from and is rebuildable
 * from the files. A draft is stored exactly as it was read — gaps and all — so the page
 * can ask for what is missing instead of refusing to save.
 */

export type CardRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  company: string;
  role: string;
  sourceUrl: string;
  sourceKind: string;
  poolId: number | null;
  family: Family | null;
  missing: string[];
  renderedAt: string | null;
  overflowPx: number | null;
  fellBack: boolean | null;
};

type Row = Record<string, unknown>;

const p = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const rowOf = (r: Row): CardRow => ({
  id: String(r.id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  company: String(r.company),
  role: String(r.role),
  sourceUrl: String(r.source_url),
  sourceKind: String(r.source_kind),
  poolId: r.pool_id === null || r.pool_id === undefined ? null : Number(r.pool_id),
  family: (r.family as Family | null) ?? null,
  missing: p<string[]>(r.missing_json, []),
  renderedAt: (r.rendered_at as string | null) ?? null,
  overflowPx: r.overflow_px === null || r.overflow_px === undefined ? null : Number(r.overflow_px),
  fellBack: r.fell_back === null || r.fell_back === undefined ? null : Number(r.fell_back) === 1,
});

/** `zoho-software-development-engineer-8f21` — readable in a folder listing, unique in a table. */
export function cardId(draft: JobCardDraft): string {
  const stem = [draft.company?.name, draft.role?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const tag = Math.random().toString(16).slice(2, 6);
  return `${stem || 'job-card'}-${tag}`;
}

export async function saveCard(id: string, draft: JobCardDraft, now = new Date().toISOString()): Promise<CardRow> {
  const missing = missingMandatory(draft);
  await fs.mkdir(jobcardDir(id), { recursive: true });
  await fs.writeFile(jobcardFile(id), JSON.stringify(draft, null, 2));

  const db = getDb();
  const existing = db.prepare(`SELECT created_at, family FROM jobcards WHERE id = ?`).get(id) as Row | undefined;
  db.prepare(
    `INSERT INTO jobcards (id, created_at, updated_at, company, role, source_url, source_kind, pool_id, family, card_json, missing_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at, company = excluded.company, role = excluded.role,
       source_url = excluded.source_url, source_kind = excluded.source_kind, pool_id = excluded.pool_id,
       card_json = excluded.card_json, missing_json = excluded.missing_json`
  ).run(
    id,
    existing ? String(existing.created_at) : now,
    now,
    draft.company?.name ?? '',
    draft.role?.title ?? '',
    draft.source?.url ?? '',
    draft.source?.kind ?? 'job-url',
    draft.source?.poolId ?? null,
    (existing?.family as string | null) ?? null,
    JSON.stringify(draft),
    JSON.stringify(missing)
  );
  return getRow(id)!;
}

export function getRow(id: string): CardRow | null {
  const r = getDb().prepare(`SELECT * FROM jobcards WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowOf(r) : null;
}

export function listRows(): CardRow[] {
  return (getDb().prepare(`SELECT * FROM jobcards ORDER BY created_at DESC`).all() as Row[]).map(rowOf);
}

/**
 * One page of the history, newest first. Cards are never deleted by anything here, so the
 * list only grows; the page asks for the twelve it draws and the count it needs for a pager.
 */
export function listPage(opts: { limit?: number; offset?: number } = {}): { cards: CardRow[]; total: number } {
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const db = getDb();
  const total = Number((db.prepare(`SELECT count(*) AS n FROM jobcards`).get() as Row).n);
  const rows = db
    .prepare(`SELECT * FROM jobcards ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as Row[];
  return { cards: rows.map(rowOf), total };
}

/** The document as it was stored: a draft, which is only a JobCard once nothing is missing. */
export async function readDraft(id: string): Promise<JobCardDraft | null> {
  try {
    return JSON.parse(await fs.readFile(jobcardFile(id), 'utf8')) as JobCardDraft;
  } catch {
    return null;
  }
}

/** The document as a card, or the list of what it still needs. */
export async function readCard(id: string): Promise<{ card: JobCard } | { missing: string[] } | null> {
  const draft = await readDraft(id);
  if (!draft) return null;
  const missing = missingMandatory(draft);
  if (missing.length) return { missing };
  try {
    return { card: parseJobCard(draft) };
  } catch (err) {
    return { missing: [err instanceof Error ? err.message : String(err)] };
  }
}

export function recordRender(
  id: string,
  out: { family: Family; overflowPx: number; fellBack: boolean },
  now = new Date().toISOString()
) {
  getDb()
    .prepare(`UPDATE jobcards SET family = ?, rendered_at = ?, overflow_px = ?, fell_back = ?, updated_at = ? WHERE id = ?`)
    .run(out.family, now, out.overflowPx, out.fellBack ? 1 : 0, now, id);
}

export const imagePath = (id: string) => jobcardImage(id);

export async function hasImage(id: string): Promise<boolean> {
  try {
    await fs.access(jobcardImage(id));
    return true;
  } catch {
    return false;
  }
}

/** A logo the extractor found, written beside the document so the renderer reads it off disk. */
export async function saveLogo(id: string, bytes: Uint8Array, ext: string): Promise<string> {
  await fs.mkdir(jobcardDir(id), { recursive: true });
  const file = path.join(jobcardDir(id), `logo.${ext}`);
  await fs.writeFile(file, bytes);
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}
