# Jobs bridge: research pool to jobs-reel cuts

**Date:** 2 September 2026
**Status:** approved in conversation, spec for review
**Depends on:** research-plugin jobs mode (branch `master`, 2 Sep), jobs-reel-plugin board (`:26100`), the studio's knowledge layer (`feat/knowledge-layer`)

## Why

Two finished things do not touch. research-plugin's jobs mode sweeps 117 sources daily
and holds 6,540 listings, 930 of them India. jobs-reel-plugin turns a weekly list of
100 to 300 roles into a 60-second reel, but its only input is a published Google Sheet
whose URL is empty; every week on its board is demo data with `example.com` links.

The studio is the bridge and the operator: it pulls the pool, prepares a cut, submits it
to the reel plugin, and keeps a ledger of everything it did. The reel plugin owns the
templates and the video. The research plugin owns the pool. Neither learns the other's
schema.

Audio, cadence automation, and publishing are separate sub-projects and are out of
scope here.

## Goals

1. One loop, runnable from the Jobs page: **pull → prepare → submit → record**.
2. Weekly cuts today; daily cuts prepared and stored, rendered once the plugin has a
   daily template.
3. Every pulled listing, every mapped row, every cut, every submission and every board
   reply is stored in the studio's SQLite. Nothing is derived from memory or from the
   plugins' disks.
4. The brief from research-plugin travels with the rows: the full brief for the
   caption and IntaBot's DM, its opening and closing lines available to the reel's
   script stage.
5. The Jobs page shows the pool, the ledger of cuts, and one cut in detail with the
   reel's own summary tiles before anything is submitted.

## Non-goals

- Changing the reel's templates, scenes, voice or music.
- A scheduler. Cuts are prepared by a button in this sub-project.
- Publishing to Instagram, or IntaBot itself. The bridge only leaves `brief.md` where
  IntaBot's contract (`weeks/<key>/jobs.json`) already lives.
- Scraping or adding sources. That is research-plugin's UI.
- Global-remote cuts. India first; the filter is a setting, not a code path.

## Approach

Studio-owned bridge (approach A of three). research-plugin exposing the reel's shape
(B) would couple the pool to one consumer; jobs-reel pulling from research-plugin (C)
would couple the other way and leave nothing to manage. The studio already speaks to
both boards server-side (`lib/jobs/board.ts`) and already keeps a derived SQLite index.

## Data flow

```
research-plugin :25100
   GET  /api/jobs?category=india&tech=0&group=1&limit=500&offset=N   the pool, one row per posting family
   POST /api/jobs/brief?category=india&…                        markdown brief for the same filter
        │
        ▼ PULL      snapshot into jobs_pool, diffed against the last pull (new, refreshed, closed)
studio
        ▼ PREPARE   window → map rows to the reel schema → plan (summary tiles, thin check, brief) → cuts, cut_rows
        │
        ▼ SUBMIT
jobs-reel :26100
   POST /api/weeks/{key}/jobs    { jobs, rejected, warnings, source, brief }   writes jobs.json + brief.md
   POST /api/weeks/{key}/run     { stage: 'summarise' } then { stage: 'plan' }  (exists today)
        │
        ▼ RECORD    submissions ← board reply; Neo4j jobs space ← recordWeek (exists today) + Cut
```

## Storage

All in `data/iolar.db`, created by `lib/db.ts` `SCHEMA` beside the handbook tables.
Derived from the plugins, rebuildable by pulling again; the ledger is the one thing
that is not rebuildable, so it is written first and never deleted.

```sql
CREATE TABLE IF NOT EXISTS jobs_pool (
  research_id  INTEGER PRIMARY KEY,   -- research-plugin's id
  family_key   TEXT NOT NULL,
  company      TEXT NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,         -- india | global-remote | other
  remote       INTEGER NOT NULL,
  posted_at    TEXT,                  -- research-plugin's postedAt, may be null
  first_seen   TEXT NOT NULL,         -- when this studio first saw it
  last_seen    TEXT NOT NULL,         -- last pull that returned it
  closed_at    TEXT,                  -- first pull that no longer returned it
  raw_json     TEXT NOT NULL          -- the whole JobRow
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
  period_key   TEXT NOT NULL,         -- 2026-W37 or 2026-09-03
  kind         TEXT NOT NULL,         -- weekly | daily
  window_from  TEXT NOT NULL,         -- ISO date, inclusive
  window_to    TEXT NOT NULL,         -- ISO date, inclusive
  filter_json  TEXT NOT NULL,         -- category, techOnly, q
  status       TEXT NOT NULL,         -- prepared | thin | submitted | summarised | planned | failed
  counted      INTEGER NOT NULL,
  rejected     INTEGER NOT NULL,
  summary_json TEXT NOT NULL,         -- the reel's summary, computed here
  brief_md     TEXT,                  -- research-plugin's brief for the same filter
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(period_key, kind)
);

CREATE TABLE IF NOT EXISTS cut_rows (
  cut_id       INTEGER NOT NULL REFERENCES cuts(id),
  research_id  INTEGER NOT NULL REFERENCES jobs_pool(research_id),
  row_json     TEXT,                  -- the mapped reel row, null when rejected
  mapped_by    TEXT NOT NULL,         -- rule | qwen | rejected
  reject_reason TEXT,
  PRIMARY KEY (cut_id, research_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cut_id       INTEGER NOT NULL REFERENCES cuts(id),
  at           TEXT NOT NULL,
  accepted     INTEGER NOT NULL,
  rejected     INTEGER NOT NULL,
  stage        TEXT,                  -- the board's stage after summarise/plan
  reply_json   TEXT NOT NULL,
  error        TEXT
);
```

`dropLegacySchema` is not involved; these are new tables and `CREATE IF NOT EXISTS`
carries them.

## Pull

`lib/jobs/pool.ts`:

- `pullPool(filter)` pages `GET /api/jobs` with `group=1`, `limit=500`, until `items`
  is shorter than the page, under one `pulls` row. Every returned id is upserted into
  `jobs_pool` with `last_seen = now`; ids present in the last pull for the same filter
  and absent now get `closed_at = now`. Returns `{ fetched, added, refreshed, closed }`.
- A pull never throws to the page: a research-plugin that is down is a `pulls` row
  with `error` and a message on the page with a link to Plugins.
- The filter is `{ category: 'india', techOnly: false, q: '' }` by default, from
  `lib/settings.ts` keys `jobsCategory`, `jobsTechOnly`. research-plugin's query
  parameters, read from its `src/lib/jobs/query.ts` on 2 September: `category`
  (`india | global-remote | other | all`), `q`, `company`, `since` (ISO date, posted
  on or after), `remote=1`, `tech` (tech-only is the default; `tech=0` sees
  everything), `includeClosed=1`, `limit`, `offset`, `group=1`. A pull sends
  `category`, `tech`, `q`, `group=1`, `limit=500`, `offset`. The brief endpoint reads
  the same parameters. The pool test pins these names.

## Prepare

`lib/jobs/cut.ts`:

- **Window.** Weekly: Monday 00:00 to Sunday 23:59 of the ISO week, key `YYYY-Www`.
  Daily: the day, key `YYYY-MM-DD`. A row is in the window when `posted_at` (or
  `first_seen` when null) falls inside it and `closed_at` is null.
- **Map** (`lib/jobs/map.ts`), one pool row to one reel row, or a rejection with a reason:

| Reel field | From | Rule |
|---|---|---|
| `id` | family_key, period_key | `${familyKey}|${periodKey}`, stable across re-cuts |
| `role` | title | as is |
| `company` | company | as is |
| `function` | title, tags | rule table: engineer/developer/SRE/devops/backend/frontend/mobile/QA → engineering; data/analyst/ML/AI → data; designer/UX/UI → design; product manager/PM → product; ops/operations/support/success → operations; sales/account/BD → sales; marketing/growth/content → marketing; finance/accounts → finance; HR/recruiter/talent/people → hr. Unmatched titles go to qwen in one batched call per cut with the ten labels; anything else is `other` |
| `location` | locations[0], remote | first location's city segment; `Remote` when remote and no city |
| `workMode` | remote, location, description | `remote` when flagged; `hybrid` when the word appears in location or description; else `onsite` |
| `experienceMin/Max` | title, description | a `N-M years` or `N+ years` in the description wins; else title words: intern 0-1, junior/associate 0-2, senior 5-9, staff/principal/lead 8-15, head/director/VP 10-20; else 2-5 |
| `salaryMin/Max` | salary | parse INR forms (`₹`, `INR`, `LPA`, `lakh`, `L`) to annual rupees; a single figure fills both; any other currency or unparseable → null, null |
| `currency` | | `INR` |
| `postedOn` | posted_at, first_seen | date part |
| `closesOn` | | null; nothing in the pool carries deadlines |
| `link` | url | as is |

  A row is rejected, with the reason, when `link` is not a URL, `company` or `title` is
  empty, or the reel's `JobSchema` refuses it after mapping. The studio validates with a
  copy of that zod schema (`lib/jobs/reelSchema.ts`, kept identical to the plugin's
  `lib/schema/jobs.ts`, with a test that diffs the two files).

- **Plan.** Compute the reel's summary with the plugin's own arithmetic ported to
  `lib/jobs/summarise.ts` (counts by function, experience band, work mode, top cities,
  salary bands, salary coverage, top employers, closing soon). The port is tested
  against the plugin's `weeks/2026-W46/summary.json` from its `jobs.json`, so the tiles
  the page shows are the tiles the reel will show. Fetch the brief for the same filter
  from `POST /api/jobs/brief`; store it. A cut with fewer than 20 accepted rows is
  status `thin` and is not submitted by the automatic path; the page can still submit
  it by hand.

## Submit

New endpoint in jobs-reel-plugin, `app/api/weeks/[week]/jobs/route.ts`:

```
POST /api/weeks/{key}/jobs
body: { jobs: Job[], rejected: RejectedRow[], warnings: string[],
        source: { kind: 'studio', cutId: number, pulledAt: string }, brief?: string, force?: boolean }
→ 200 { ok: true, week, counted, rejected }
→ 400 { ok: false, message }           zod failure, with the first issue
→ 409 { ok: false, message }           the week already has an export and force is not set
```

It validates with the plugin's `JobsFileSchema` extended by a `source.kind` of `studio`
beside `sheet`, writes `weeks/<key>/jobs.json` and, when present, `weeks/<key>/brief.md`,
and never touches later stages. `key` accepts `YYYY-Www` today and `YYYY-MM-DD`; a day
key is stored and listed with stage `imported` and renders once the plugin has a daily
template. The OpenAPI document gains the route (the plugin's `board.openapi.test.ts`
demands it).

The plugin's script stage may read the brief's first and last paragraphs as context; the
bullets stay out of the script. That is a plugin change and lands with the daily
template work, not here; the bridge only puts `brief.md` in place.

Then the studio calls `POST /api/weeks/{key}/run` with `summarise`, then `plan`, through
`lib/jobs/board.ts` `runStage` as today, and records each reply.

## Record

- `submissions` gets one row per submit attempt with the board's reply.
- `cuts.status` follows: `submitted` → `summarised` → `planned`, or `failed` with the
  error in the latest submission.
- Neo4j: `recordWeek` (exists) runs after a successful plan through the Jobs tab's
  existing background index, plus a `Cut {periodKey, kind, counted, rejected, status}`
  node with `Cut -[:FROM_POOL {pullId}]-> Week` so the graph knows which pull fed which
  week. Written through `lib/knowledge/spaces/jobs.ts`.

## Page

`/jobs` becomes three panes, antd, same look as today:

- **Pool.** Pulled counts (total, India, new since last pull, closed), last pull time,
  research-plugin's source health from `GET /api/jobs/sources` (enabled count, last
  error), and **Pull now**.
- **Cuts.** The ledger: period, kind, counted, rejected, status tag, thin flag, links to
  the board's week. **Prepare week** and **Prepare today** buttons take the current
  window; a cut that exists for the period is re-prepared in place (same id, rows
  replaced) until it is submitted, after which a new prepare needs `force`.
- **Cut view.** The reel's summary tiles from `summary_json`, the brief, a table of
  mapped rows with `mapped_by`, a table of rejects with reasons, and **Submit**, which
  runs submit → summarise → plan and shows each reply as it lands via the plugin
  activity feed.

The existing weeks table (the board's list) stays as a fourth pane, unchanged.

## API surface (studio)

```
POST /api/jobs/pool/pull                       → pulls row
GET  /api/jobs/pool                            → counts, last pull, sources health
POST /api/jobs/cuts        { kind, periodKey? } → cut (prepared or thin)
GET  /api/jobs/cuts                            → ledger
GET  /api/jobs/cuts/[id]                       → cut, rows, rejects, submissions
POST /api/jobs/cuts/[id]/submit { force? }     → submission, then summarise, then plan
```

## Settings

`jobsCategory: 'india'`, `jobsTechOnly: false`, `jobsThinBelow: 20`.

## Testing

- `map.ts`: one test per rule row with a real pool listing copied from the live API on
  2 September; the qwen fallback mocked to return labels; rejections carry reasons.
- `summarise.ts`: parity against the plugin's `weeks/2026-W46/jobs.json` → `summary.json`.
- `reelSchema.ts`: a test that reads the plugin's `lib/schema/jobs.ts` and asserts the
  two zod sources are byte-equal, so drift is a failing test, not a 400 in production.
- `pool.ts`: paging, diffing, closing, and a down research-plugin, all with mocked
  fetch.
- `cut.ts`: a window, a thin cut, a re-prepare in place, a refused re-prepare after
  submit.
- Board endpoint (in jobs-reel): schema refusal, force refusal, files written, OpenAPI
  updated.
- Page: three panes render from mocked routes; Submit posts and shows the reply.
- Live, opt-in: one pull against `:25100` and one submit of a `daily` key against
  `:26100` into a throwaway period, deleted after.

## Risks

- **Function mapping quality.** Rules cover most Indian tech titles; qwen catches the
  rest at one batched call per cut. The `mapped_by` column makes the model's share
  visible so the rule table can grow from real misses.
- **Experience bands are inferred.** The reel shows bands, not years; a wrong band moves
  one count. The description regex wins when present.
- **Deadlines are absent.** The "closing soon" tile reads zero until a source carries
  them. The reel's planner already handles a zero tile.
- **Pool schema drift.** `raw_json` keeps whatever research-plugin sent; the mapper reads
  named fields and a test pins them against a saved live sample.
