import { getDb } from '@/lib/db';

/**
 * The jobs bridge's ledger. Every pull, every pool row, every cut, every mapped row and
 * every board reply is a row here, written before the call it describes. The pool is
 * rebuildable by pulling again; the ledger is not, and nothing here deletes.
 */

export type PoolRow = {
  researchId: number;
  familyKey: string;
  company: string;
  title: string;
  category: string;
  remote: boolean;
  postedAt: string | null;
  firstSeen: string;
  lastSeen: string;
  closedAt: string | null;
  raw: Record<string, unknown>;
};

export type CutStatus = 'prepared' | 'thin' | 'submitted' | 'summarised' | 'planned' | 'scripted' | 'voiced' | 'building' | 'failed';
export type CutKind = 'weekly' | 'daily';

export type Cut = {
  id: number;
  periodKey: string;
  kind: CutKind;
  windowFrom: string;
  windowTo: string;
  filter: Record<string, unknown>;
  status: CutStatus;
  counted: number;
  rejected: number;
  summary: unknown;
  briefMd: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CutRow = {
  cutId: number;
  researchId: number;
  row: Record<string, unknown> | null;
  mappedBy: 'rule' | 'qwen' | 'rejected';
  rejectReason: string | null;
};

export type Submission = {
  id: number;
  cutId: number;
  at: string;
  accepted: number;
  rejected: number;
  stage: string | null;
  reply: unknown;
  error: string | null;
};

export type Pull = { id: number; at: string; filter: Record<string, unknown>; fetched: number; added: number; refreshed: number; closed: number; error: string | null };

type Row = Record<string, unknown>;
const j = (v: unknown) => JSON.stringify(v);
const p = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

// ---- pulls -------------------------------------------------------------------------

export function startPull(filter: Record<string, unknown>, at = new Date().toISOString()): number {
  const r = getDb()
    .prepare(`INSERT INTO pulls (at, filter_json, fetched, added, refreshed, closed) VALUES (?, ?, 0, 0, 0, 0)`)
    .run(at, j(filter));
  return Number(r.lastInsertRowid);
}

export function finishPull(id: number, out: { fetched: number; added: number; refreshed: number; closed: number; error?: string | null }) {
  getDb()
    .prepare(`UPDATE pulls SET fetched = ?, added = ?, refreshed = ?, closed = ?, error = ? WHERE id = ?`)
    .run(out.fetched, out.added, out.refreshed, out.closed, out.error ?? null, id);
}

const pullOf = (r: Row): Pull => ({
  id: Number(r.id),
  at: String(r.at),
  filter: p(r.filter_json, {}),
  fetched: Number(r.fetched),
  added: Number(r.added),
  refreshed: Number(r.refreshed),
  closed: Number(r.closed),
  error: (r.error as string | null) ?? null,
});

export function lastPull(): Pull | null {
  const r = getDb().prepare(`SELECT * FROM pulls ORDER BY id DESC LIMIT 1`).get() as Row | undefined;
  return r ? pullOf(r) : null;
}

export function getPull(id: number): Pull | null {
  const r = getDb().prepare(`SELECT * FROM pulls WHERE id = ?`).get(id) as Row | undefined;
  return r ? pullOf(r) : null;
}

// ---- pool --------------------------------------------------------------------------

export type PoolUpsert = Omit<PoolRow, 'firstSeen' | 'lastSeen' | 'closedAt'>;

/** Rows seen in this pull. Known ids are refreshed (and reopened); new ids are added. */
export function upsertPool(rows: PoolUpsert[], now: string): { added: number; refreshed: number } {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM jobs_pool WHERE research_id = ?`);
  const insert = db.prepare(
    `INSERT INTO jobs_pool (research_id, family_key, company, title, category, remote, posted_at, first_seen, last_seen, closed_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  const update = db.prepare(
    `UPDATE jobs_pool SET family_key = ?, company = ?, title = ?, category = ?, remote = ?, posted_at = ?, last_seen = ?, closed_at = NULL, raw_json = ?
     WHERE research_id = ?`
  );
  let added = 0;
  let refreshed = 0;
  for (const r of rows) {
    if (exists.get(r.researchId)) {
      update.run(r.familyKey, r.company, r.title, r.category, r.remote ? 1 : 0, r.postedAt, now, j(r.raw), r.researchId);
      refreshed++;
    } else {
      insert.run(r.researchId, r.familyKey, r.company, r.title, r.category, r.remote ? 1 : 0, r.postedAt, now, now, j(r.raw));
      added++;
    }
  }
  return { added, refreshed };
}

/** Open rows of a category that this pull did not return are closed as of now. */
export function closeMissing(seenIds: number[], category: string, now: string): number {
  const db = getDb();
  const open = db.prepare(`SELECT research_id FROM jobs_pool WHERE category = ? AND closed_at IS NULL`).all(category) as { research_id: number }[];
  const seen = new Set(seenIds);
  const close = db.prepare(`UPDATE jobs_pool SET closed_at = ? WHERE research_id = ?`);
  let n = 0;
  for (const r of open) {
    if (seen.has(Number(r.research_id))) continue;
    close.run(now, r.research_id);
    n++;
  }
  return n;
}

const poolOf = (r: Row): PoolRow => ({
  researchId: Number(r.research_id),
  familyKey: String(r.family_key),
  company: String(r.company),
  title: String(r.title),
  category: String(r.category),
  remote: Number(r.remote) === 1,
  postedAt: (r.posted_at as string | null) ?? null,
  firstSeen: String(r.first_seen),
  lastSeen: String(r.last_seen),
  closedAt: (r.closed_at as string | null) ?? null,
  raw: p(r.raw_json, {}),
});

/** Open rows posted (or first seen, when the source gave no date) inside [from, to], dates inclusive. */
export function poolInWindow(from: string, to: string, category: string): PoolRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM jobs_pool
        WHERE closed_at IS NULL AND (? = 'all' OR category = ?)
          AND substr(coalesce(posted_at, first_seen), 1, 10) BETWEEN ? AND ?
        ORDER BY coalesce(posted_at, first_seen) DESC, research_id`
    )
    .all(category, category, from, to) as Row[];
  return rows.map(poolOf);
}

export function poolCounts(category: string): { total: number; open: number; closed: number; newSince: (iso: string) => number } {
  const db = getDb();
  const where = category === 'all' ? '' : `WHERE category = '${category.replace(/'/g, '')}'`;
  const total = Number((db.prepare(`SELECT count(*) AS n FROM jobs_pool ${where}`).get() as Row).n);
  const open = Number((db.prepare(`SELECT count(*) AS n FROM jobs_pool ${where ? where + ' AND' : 'WHERE'} closed_at IS NULL`).get() as Row).n);
  return {
    total,
    open,
    closed: total - open,
    newSince: (iso: string) =>
      Number((db.prepare(`SELECT count(*) AS n FROM jobs_pool ${where ? where + ' AND' : 'WHERE'} first_seen >= ?`).get(iso) as Row).n),
  };
}

// ---- cuts --------------------------------------------------------------------------

const cutOf = (r: Row): Cut => ({
  id: Number(r.id),
  periodKey: String(r.period_key),
  kind: r.kind as CutKind,
  windowFrom: String(r.window_from),
  windowTo: String(r.window_to),
  filter: p(r.filter_json, {}),
  status: r.status as CutStatus,
  counted: Number(r.counted),
  rejected: Number(r.rejected),
  summary: p(r.summary_json, null),
  briefMd: (r.brief_md as string | null) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export class CutLocked extends Error {}

/**
 * One cut per period and kind. While it is only prepared it is replaced in place on
 * every prepare; once it has been submitted a new prepare needs `force`, which the
 * caller passes by deleting nothing and asking with `replaceSubmitted`.
 */
export function createCut(
  c: Omit<Cut, 'id' | 'createdAt' | 'updatedAt'>,
  opts: { replaceSubmitted?: boolean; now?: string } = {}
): Cut {
  const db = getDb();
  const now = opts.now ?? new Date().toISOString();
  const existing = db.prepare(`SELECT * FROM cuts WHERE period_key = ? AND kind = ?`).get(c.periodKey, c.kind) as Row | undefined;
  if (existing) {
    const status = String(existing.status);
    if (!['prepared', 'thin', 'failed'].includes(status) && !opts.replaceSubmitted) {
      throw new CutLocked(`cut ${c.periodKey} (${c.kind}) was already ${status}; prepare again with force to replace it`);
    }
    db.prepare(
      `UPDATE cuts SET window_from = ?, window_to = ?, filter_json = ?, status = ?, counted = ?, rejected = ?, summary_json = ?, brief_md = ?, updated_at = ?
       WHERE id = ?`
    ).run(c.windowFrom, c.windowTo, j(c.filter), c.status, c.counted, c.rejected, j(c.summary), c.briefMd, now, Number(existing.id));
    return getCut(Number(existing.id))!;
  }
  const r = db
    .prepare(
      `INSERT INTO cuts (period_key, kind, window_from, window_to, filter_json, status, counted, rejected, summary_json, brief_md, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(c.periodKey, c.kind, c.windowFrom, c.windowTo, j(c.filter), c.status, c.counted, c.rejected, j(c.summary), c.briefMd, now, now);
  return getCut(Number(r.lastInsertRowid))!;
}

export function replaceCutRows(cutId: number, rows: CutRow[]) {
  const db = getDb();
  db.prepare(`DELETE FROM cut_rows WHERE cut_id = ?`).run(cutId);
  const ins = db.prepare(`INSERT INTO cut_rows (cut_id, research_id, row_json, mapped_by, reject_reason) VALUES (?, ?, ?, ?, ?)`);
  for (const r of rows) ins.run(cutId, r.researchId, r.row ? j(r.row) : null, r.mappedBy, r.rejectReason);
}

export function setCutStatus(cutId: number, status: CutStatus, now = new Date().toISOString()) {
  getDb().prepare(`UPDATE cuts SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, cutId);
}

export function getCut(id: number): Cut | null {
  const r = getDb().prepare(`SELECT * FROM cuts WHERE id = ?`).get(id) as Row | undefined;
  return r ? cutOf(r) : null;
}

export function listCuts(): Cut[] {
  return (getDb().prepare(`SELECT * FROM cuts ORDER BY period_key DESC, kind`).all() as Row[]).map(cutOf);
}

export function cutRows(cutId: number): CutRow[] {
  return (getDb().prepare(`SELECT * FROM cut_rows WHERE cut_id = ? ORDER BY mapped_by, research_id`).all(cutId) as Row[]).map((r) => ({
    cutId: Number(r.cut_id),
    researchId: Number(r.research_id),
    row: p<Record<string, unknown> | null>(r.row_json, null),
    mappedBy: r.mapped_by as CutRow['mappedBy'],
    rejectReason: (r.reject_reason as string | null) ?? null,
  }));
}

// ---- submissions -------------------------------------------------------------------

const subOf = (r: Row): Submission => ({
  id: Number(r.id),
  cutId: Number(r.cut_id),
  at: String(r.at),
  accepted: Number(r.accepted),
  rejected: Number(r.rejected),
  stage: (r.stage as string | null) ?? null,
  reply: p(r.reply_json, null),
  error: (r.error as string | null) ?? null,
});

export function addSubmission(s: Omit<Submission, 'id'>): Submission {
  const r = getDb()
    .prepare(`INSERT INTO submissions (cut_id, at, accepted, rejected, stage, reply_json, error) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(s.cutId, s.at, s.accepted, s.rejected, s.stage, j(s.reply), s.error);
  return subOf(getDb().prepare(`SELECT * FROM submissions WHERE id = ?`).get(Number(r.lastInsertRowid)) as Row);
}

export function submissionsFor(cutId: number): Submission[] {
  return (getDb().prepare(`SELECT * FROM submissions WHERE cut_id = ? ORDER BY id`).all(cutId) as Row[]).map(subOf);
}
