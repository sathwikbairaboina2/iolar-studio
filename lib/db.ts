import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import path from 'path';
import { dataRoot } from './paths';

let db: DatabaseSync | null = null;
let dbPath = '';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subjects (
  slug        TEXT PRIMARY KEY,
  name        TEXT,
  emoji       TEXT,
  description TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
  subject     TEXT NOT NULL,
  slug        TEXT NOT NULL,
  title       TEXT,
  parts       INTEGER,
  points      INTEGER,
  pages       INTEGER,
  avg_fill    INTEGER,
  status      TEXT,
  updated_at  TEXT,
  PRIMARY KEY (subject, slug)
);
CREATE TABLE IF NOT EXISTS parts (
  subject     TEXT NOT NULL,
  chapter     TEXT NOT NULL,
  part        INTEGER NOT NULL,
  slide_count INTEGER,
  post_json   TEXT,
  updated_at  TEXT,
  PRIMARY KEY (subject, chapter, part)
);
CREATE TABLE IF NOT EXISTS books (
  subject     TEXT NOT NULL,
  chapter     TEXT NOT NULL,
  title       TEXT,
  summary     TEXT,
  book_json   TEXT,
  updated_at  TEXT,
  PRIMARY KEY (subject, chapter)
);
CREATE TABLE IF NOT EXISTS refs (
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  idx     INTEGER NOT NULL,
  url     TEXT NOT NULL,
  PRIMARY KEY (subject, chapter, idx)
);
CREATE TABLE IF NOT EXISTS renders (
  subject     TEXT NOT NULL,
  chapter     TEXT NOT NULL,
  part        INTEGER NOT NULL,
  slide       INTEGER NOT NULL,
  overflow_px INTEGER,
  fill_pct    INTEGER,
  rendered_at TEXT,
  PRIMARY KEY (subject, chapter, part, slide)
);
-- The knowledge graph moved to Neo4j on 2 September 2026 (lib/knowledge/).

-- The jobs bridge: the research pool as the studio saw it, and a ledger of every cut
-- it prepared and submitted to the jobs-reel board. The pool is rebuildable by pulling
-- again; the ledger is not, and is never deleted.
CREATE TABLE IF NOT EXISTS jobs_pool (
  research_id  INTEGER PRIMARY KEY,
  family_key   TEXT NOT NULL,
  company      TEXT NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  remote       INTEGER NOT NULL,
  posted_at    TEXT,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  closed_at    TEXT,
  raw_json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pool_seen ON jobs_pool(last_seen, category);
CREATE TABLE IF NOT EXISTS pulls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  filter_json  TEXT NOT NULL,
  fetched      INTEGER NOT NULL,
  added        INTEGER NOT NULL,
  refreshed    INTEGER NOT NULL,
  closed       INTEGER NOT NULL,
  error        TEXT
);
CREATE TABLE IF NOT EXISTS cuts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period_key   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  window_from  TEXT NOT NULL,
  window_to    TEXT NOT NULL,
  filter_json  TEXT NOT NULL,
  status       TEXT NOT NULL,
  counted      INTEGER NOT NULL,
  rejected     INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  brief_md     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(period_key, kind)
);
CREATE TABLE IF NOT EXISTS cut_rows (
  cut_id        INTEGER NOT NULL REFERENCES cuts(id),
  research_id   INTEGER NOT NULL,
  row_json      TEXT,
  mapped_by     TEXT NOT NULL,
  reject_reason TEXT,
  PRIMARY KEY (cut_id, research_id)
);
CREATE TABLE IF NOT EXISTS jobcards (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  company      TEXT NOT NULL,
  role         TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  source_kind  TEXT NOT NULL,
  pool_id      INTEGER,
  family       TEXT,
  card_json    TEXT NOT NULL,
  missing_json TEXT NOT NULL,
  rendered_at  TEXT,
  overflow_px  INTEGER,
  fell_back    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobcards_made ON jobcards(created_at DESC);
CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cut_id       INTEGER NOT NULL REFERENCES cuts(id),
  at           TEXT NOT NULL,
  accepted     INTEGER NOT NULL,
  rejected     INTEGER NOT NULL,
  stage        TEXT,
  reply_json   TEXT NOT NULL,
  error        TEXT
);
`;

/**
 * The database is a derived index, rebuildable from the files with `scripts/reindex.mts`.
 * When it predates the subject/chapter layout, dropping it beats migrating columns.
 */
function dropLegacySchema(handle: DatabaseSync) {
  const tables = handle
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as { name: string }[];
  if (!tables.some((t) => t.name === 'nodes')) return;

  // The graph moved to Neo4j on 2 September 2026. These two tables are dead weight, and
  // once they are gone this function has nothing left to decide on the next open.
  const cols = handle.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
  if (cols.some((c) => c.name === 'subject')) {
    for (const t of ['nodes', 'edges']) handle.exec(`DROP TABLE IF EXISTS ${t}`);
    return;
  }

  for (const t of ['posts', 'books', 'refs', 'renders', 'nodes', 'edges', 'chapters', 'parts', 'subjects']) {
    handle.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  console.warn('[instastudio] rebuilt the index for the handbooks layout — run scripts/reindex.mts');
}

export function getDb(): DatabaseSync {
  const want = path.join(dataRoot(), 'iolar.db');
  if (db && dbPath === want) return db;
  mkdirSync(path.dirname(want), { recursive: true });
  db = new DatabaseSync(want);
  db.exec('PRAGMA journal_mode = WAL;');
  // The dev server and build scripts write at once; wait for the lock instead of failing.
  db.exec('PRAGMA busy_timeout = 5000;');
  dropLegacySchema(db);
  db.exec(SCHEMA);
  dbPath = want;
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
  dbPath = '';
}
