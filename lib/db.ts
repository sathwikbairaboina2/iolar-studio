import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import path from 'path';
import { dataRoot } from './store';

let db: DatabaseSync | null = null;
let dbPath = '';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  slug        TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'paperbook',
  series      TEXT,
  template    TEXT,
  ratio       TEXT,
  slide_count INTEGER,
  status      TEXT,
  post_json   TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS books (
  slug        TEXT PRIMARY KEY,
  title       TEXT,
  summary     TEXT,
  book_json   TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS refs (
  slug  TEXT NOT NULL,
  idx   INTEGER NOT NULL,
  url   TEXT NOT NULL,
  PRIMARY KEY (slug, idx)
);
CREATE TABLE IF NOT EXISTS renders (
  slug        TEXT NOT NULL,
  slide       INTEGER NOT NULL,
  overflow_px INTEGER,
  fill_pct    INTEGER,
  rendered_at TEXT,
  PRIMARY KEY (slug, slide)
);
CREATE TABLE IF NOT EXISTS nodes (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,          -- post | chapter | topic
  label    TEXT NOT NULL,
  slug     TEXT,
  weight   INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS edges (
  src   TEXT NOT NULL,
  dst   TEXT NOT NULL,
  rel   TEXT NOT NULL,             -- has_chapter | covers | shares_topic
  PRIMARY KEY (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS idx_nodes_slug ON nodes(slug);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
`;

export function getDb(): DatabaseSync {
  const want = path.join(dataRoot(), 'iolar.db');
  if (db && dbPath === want) return db;
  mkdirSync(path.dirname(want), { recursive: true });
  db = new DatabaseSync(want);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  dbPath = want;
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
  dbPath = '';
}
