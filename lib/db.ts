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
CREATE TABLE IF NOT EXISTS reels (
  slug        TEXT PRIMARY KEY,
  title       TEXT,
  pattern     TEXT,
  beats       INTEGER,
  duration_ms INTEGER,
  status      TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS nodes (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,          -- subject | chapter | topic | reel
  label    TEXT NOT NULL,
  subject  TEXT,
  chapter  TEXT,
  weight   INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS edges (
  src   TEXT NOT NULL,
  dst   TEXT NOT NULL,
  rel   TEXT NOT NULL,             -- has_chapter | covers | shares_topic
  PRIMARY KEY (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS idx_nodes_chapter ON nodes(subject, chapter);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
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

  const cols = handle.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
  if (cols.some((c) => c.name === 'subject')) return;

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
