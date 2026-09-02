# Jobs Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The studio pulls the India job pool from research-plugin, prepares weekly or daily cuts in the jobs-reel schema, submits them to the jobs-reel board, and keeps a SQLite ledger of every pull, cut, row and reply.

**Architecture:** Four studio modules under `lib/jobs/`: `pool.ts` (pull and diff into SQLite), `map.ts` (pool row to reel row, rules then one batched qwen call), `summarise.ts` (the plugin's arithmetic, ported), `cut.ts` (window, plan, thin check, ledger writes) and `submit.ts` (post to the board, record replies, Cut node in Neo4j). One new endpoint in jobs-reel-plugin accepts a cut. The Jobs page grows Pool, Cuts and Cut panes.

**Tech Stack:** Next 16.3.3 App Router, TypeScript, zod 4 (studio) and zod 3 (plugin), node:sqlite, vitest 4 (studio) and vitest 2 (plugin), antd 6, research-plugin `:25100`, jobs-reel board `:26100`, qwen via `lib/ai/qwen.ts`.

**Spec:** `docs/superpowers/specs/2026-09-02-jobs-bridge-design.md`

## Global Constraints

- research-plugin query parameters: `category`, `q`, `company`, `since`, `remote=1`, `tech` (`tech=0` sees everything), `includeClosed=1`, `limit`, `offset`, `group=1`. Default filter `{ category: 'india', tech: '0' }`.
- The reel schema copy in the studio must accept and reject exactly what the plugin's `lib/schema/jobs.ts` does; a test proves it against the plugin on disk at `JOBS_REEL_DIR` (default `C:/Users/sathwik/projects/plugins/jobs-reel-plugin`).
- Thin cut: fewer than `jobsThinBelow` (20) accepted rows. Status `thin`, never auto-submitted.
- Period keys: weekly `YYYY-Www` (ISO week, Monday start), daily `YYYY-MM-DD`.
- Every ledger write happens before the network call it describes; a failed call is a row with `error`, never a missing row.
- A pull, prepare or submit never throws to the page; the page shows the message and a link to Plugins.
- All plugin calls go through `lib/jobs/board.ts` (jobs-reel) and a new `lib/jobs/researchApi.ts` (research-plugin); no `fetch` to those hosts anywhere else.
- Studio commands: `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint <paths>`. Plugin commands: `npm test`, `npm run typecheck` in the plugin dir.
- Commit per task in whichever repo the task touches. Messages lowercase, `feat:`/`fix:`/`test:`/`docs:`, end with the `Co-Authored-By` and `Claude-Session` lines used in this repo.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/settings.ts` | `jobsCategory`, `jobsTechOnly`, `jobsThinBelow` |
| `lib/db.ts` | five new tables in `SCHEMA` |
| `lib/jobs/ledger.ts` | typed reads and writes for `pulls`, `jobs_pool`, `cuts`, `cut_rows`, `submissions` |
| `lib/jobs/researchApi.ts` | `listPool(filter, page)`, `briefFor(filter)` against `:25100` |
| `lib/jobs/pool.ts` | `pullPool(filter)`: page, upsert, diff, close |
| `lib/jobs/reelSchema.ts` | zod 4 copy of the plugin's Job, RejectedRow, JobsFile |
| `lib/jobs/map.ts` | `mapRow`, `mapRows` with the qwen batch for unmapped functions |
| `lib/jobs/summarise.ts` | the plugin's `summarise` minus highlights |
| `lib/jobs/period.ts` | `weekKey(date)`, `dayKey(date)`, `windowFor(key)` |
| `lib/jobs/cut.ts` | `prepareCut(kind, periodKey?)`, `cutView(id)` |
| `lib/jobs/submit.ts` | `submitCut(id, force)`: board post, summarise, plan, record |
| `lib/jobs/board.ts` | `submitJobs(key, body)` added |
| `lib/knowledge/spaces/jobs.ts` | `recordCut(cut)` added |
| `app/api/jobs/pool/route.ts`, `app/api/jobs/pool/pull/route.ts` | pool status, pull |
| `app/api/jobs/cuts/route.ts`, `app/api/jobs/cuts/[id]/route.ts`, `app/api/jobs/cuts/[id]/submit/route.ts` | cuts |
| `app/jobs/page.tsx` | four panes |
| `components/jobs/*.tsx` | `PoolPane`, `CutsPane`, `CutView` |
| jobs-reel: `lib/schema/jobs.ts`, `app/api/weeks/[week]/jobs/route.ts`, `lib/board/openapi.ts`, `lib/board/weeks.ts`, `app/api/weeks/[week]/run/route.ts` | accept a cut, day keys |
| `tests/fixtures/jobs-pool.sample.json`, `tests/fixtures/jobs-reel-2026-W46/{jobs,summary}.json` | live samples pinned |

---

### Task 1: Settings, tables, ledger

**Files:** modify `lib/settings.ts`, `lib/db.ts`; create `lib/jobs/ledger.ts`; test `tests/jobs.ledger.test.ts`.

**Produces:**

```ts
export type PoolRow = { researchId: number; familyKey: string; company: string; title: string; category: string; remote: boolean; postedAt: string | null; firstSeen: string; lastSeen: string; closedAt: string | null; raw: Record<string, unknown> };
export type Cut = { id: number; periodKey: string; kind: 'weekly' | 'daily'; windowFrom: string; windowTo: string; filter: Record<string, unknown>; status: 'prepared' | 'thin' | 'submitted' | 'summarised' | 'planned' | 'failed'; counted: number; rejected: number; summary: unknown; briefMd: string | null; createdAt: string; updatedAt: string };
export type CutRow = { cutId: number; researchId: number; row: Record<string, unknown> | null; mappedBy: 'rule' | 'qwen' | 'rejected'; rejectReason: string | null };
export type Submission = { id: number; cutId: number; at: string; accepted: number; rejected: number; stage: string | null; reply: unknown; error: string | null };
startPull(filter): number                          // pulls.id
finishPull(id, { fetched, added, refreshed, closed, error? })
upsertPool(rows: Omit<PoolRow,'firstSeen'|'lastSeen'|'closedAt'>[], now: string): { added: number; refreshed: number }
closeMissing(seenIds: number[], filterCategory: string, now: string): number
poolInWindow(from: string, to: string, category: string): PoolRow[]
poolCounts(category): { total: number; open: number; newSince: (iso) => number; closed: number }
lastPull(): { id, at, fetched, added, refreshed, closed, error } | null
createCut(c: Omit<Cut,'id'|'createdAt'|'updatedAt'>): Cut   // upsert on (periodKey, kind) while status is prepared|thin
replaceCutRows(cutId, rows: CutRow[])
setCutStatus(cutId, status)
getCut(id): Cut | null; listCuts(): Cut[]; cutRows(cutId): CutRow[]
addSubmission(s: Omit<Submission,'id'>): Submission; submissionsFor(cutId): Submission[]
```

- [ ] Write `tests/jobs.ledger.test.ts`: fresh `IOLAR_DATA_DIR` per test; upsert two rows twice (added 2 then refreshed 2); close one missing id (closed 1, `closedAt` set); `poolInWindow` returns only open rows with `posted_at` or `first_seen` inside; `createCut` twice for one period replaces in place while prepared and throws once status is `submitted`; `addSubmission` round-trips.
- [ ] Run, expect failure (module missing).
- [ ] Add the three settings keys with defaults `'india'`, `false`, `20`. Add the five `CREATE TABLE IF NOT EXISTS` blocks from the spec to `SCHEMA`. Write `ledger.ts` with `getDb()` prepared statements; JSON columns parsed on read.
- [ ] Run, expect pass. `npx tsc --noEmit -p .`.
- [ ] Commit: `feat: a ledger for the jobs bridge: pool, pulls, cuts, rows, submissions`.

### Task 2: research-plugin client and the pull

**Files:** create `lib/jobs/researchApi.ts`, `lib/jobs/pool.ts`, `app/api/jobs/pool/route.ts`, `app/api/jobs/pool/pull/route.ts`; test `tests/jobs.pool.test.ts`; fixture `tests/fixtures/jobs-pool.sample.json` captured once with `curl "http://127.0.0.1:25100/api/jobs?category=india&tech=0&group=1&limit=12" > tests/fixtures/jobs-pool.sample.json`.

**Produces:**

```ts
export type PoolFilter = { category: 'india' | 'global-remote' | 'other' | 'all'; techOnly: boolean; q?: string };
listPool(filter, { limit, offset }, opts?: { baseUrl?, fetchImpl? }): Promise<{ total: number; items: ResearchJob[] }>
briefFor(filter, opts?): Promise<string>                 // markdown, '' when the endpoint fails
pullPool(filter, opts?): Promise<{ pullId, fetched, added, refreshed, closed, error: string | null }>
sourcesHealth(opts?): Promise<{ enabled: number; total: number; lastError: string | null }>
GET  /api/jobs/pool  → { counts, lastPull, sources, filter }
POST /api/jobs/pool/pull → pullPool result
```

- [ ] Test: `listPool` builds `?category=india&tech=0&group=1&limit=500&offset=0`; `pullPool` pages until a short page, writes one `pulls` row, upserts, closes ids missing since the last pull of the same category, and on a refused connection returns `error` with the `pulls` row written and nothing thrown. `sourcesHealth` reads `/api/jobs/sources`.
- [ ] Run, expect failure. Implement. Run, expect pass, typecheck, lint.
- [ ] Live check: `curl -X POST localhost:3120/api/jobs/pool/pull` then `curl localhost:3120/api/jobs/pool` shows `open` near 900.
- [ ] Commit: `feat: the studio pulls the india job pool into its ledger`.

### Task 3: Reel schema copy and the mapper

**Files:** create `lib/jobs/reelSchema.ts`, `lib/jobs/map.ts`; test `tests/jobs.map.test.ts`, `tests/jobs.reelSchema.test.ts`.

**Produces:**

```ts
export const FUNCTIONS = [...] as const; export const WORK_MODES = [...] as const;
export const JobSchema, RejectedRowSchema, JobsFileSchema   // zod 4, same rules as the plugin; JobsFile.source.kind is 'sheet' | 'studio'; week matches /^\d{4}-W\d{2}$|^\d{4}-\d{2}-\d{2}$/
export type ReelJob = z.infer<typeof JobSchema>;
mapFunction(title: string, tags: string[]): (typeof FUNCTIONS)[number] | null
mapExperience(title: string, description: string): { min: number; max: number }
mapWorkMode(remote: boolean, location: string, description: string): 'remote' | 'hybrid' | 'onsite'
mapSalaryInr(salary: string | null): { min: number | null; max: number | null }
mapRow(job: ResearchJob, periodKey: string, fn: string): { ok: true; row: ReelJob } | { ok: false; reason: string }
mapRows(jobs: ResearchJob[], periodKey: string, classify: (titles: string[]) => Promise<string[]>): Promise<{ rows: CutRow[] }>
qwenClassify(titles: string[]): Promise<string[]>   // one batched prompt through qwenRunner(), labels from FUNCTIONS, 'other' on anything else
```

- [ ] Test each rule with rows from the fixture: an engineer title → engineering by rule; "Growth Lead" → marketing; an unmatched title goes to the classifier callback once for the whole batch; "Senior" → 5-9; "3-5 years" in description → 3-5; remote flag → remote; "hybrid" in location → hybrid; `₹12L - ₹18L` → 1,200,000 to 1,800,000; `$120k` → null; ids are `familyKey|periodKey`; a row without a URL is rejected with a reason.
- [ ] `tests/jobs.reelSchema.test.ts`: skip unless `JOBS_REEL_DIR` exists; dynamic-import `<dir>/lib/schema/jobs.ts`; for every mapped row from the fixture and for six hand-broken rows, assert `studioSchema.safeParse(x).success === pluginSchema.safeParse(x).success`.
- [ ] Run, expect failure. Implement. Run, expect pass, typecheck, lint.
- [ ] Commit: `feat: pool listings map to the reel's job rows, rules first, qwen for the rest`.

### Task 4: Summarise, ported

**Files:** create `lib/jobs/summarise.ts`; test `tests/jobs.summarise.test.ts`; fixtures copied from the plugin's `weeks/2026-W46/jobs.json` and `summary.json`.

**Produces:** `summarise(file: JobsFile, now: Date): SummaryTiles` where `SummaryTiles` is the plugin's `Summary` minus `highlights`, plus the bucket and band tables copied verbatim.

- [ ] Test: `summarise(fixtureJobs, new Date(fixtureSummary.generatedAt))` deep-equals the fixture summary with `highlights` and `generatedAt` removed.
- [ ] Run, expect failure. Port `summarise.ts` and `buckets` verbatim (labels, round4, topN, deadlines). Run, expect pass.
- [ ] Commit: `feat: the studio computes the reel's summary tiles with the plugin's own arithmetic`.

### Task 5: Prepare a cut

**Files:** create `lib/jobs/period.ts`, `lib/jobs/cut.ts`, `app/api/jobs/cuts/route.ts`, `app/api/jobs/cuts/[id]/route.ts`; test `tests/jobs.cut.test.ts`.

**Produces:**

```ts
weekKey(d: Date): string; dayKey(d: Date): string; windowFor(key: string): { from: string; to: string; kind: 'weekly' | 'daily' }
prepareCut(kind, periodKey?, opts?: { classify?, brief?, now? }): Promise<Cut>   // rows from poolInWindow, mapRows, summarise, thin check, briefFor, ledger writes
cutView(id): Promise<{ cut: Cut; rows: CutRow[]; submissions: Submission[] } | null>
GET /api/jobs/cuts → { cuts }; POST /api/jobs/cuts { kind, periodKey? } → cut; GET /api/jobs/cuts/[id] → cutView
```

- [ ] Test: `weekKey(2026-09-02)` is `2026-W36` and its window is Monday 31 Aug to Sunday 6 Sep; `dayKey`; a prepare over a seeded pool of 25 open rows gives status `prepared`, counted 25, a summary with `byFunction`; 12 rows gives `thin`; re-prepare replaces rows in place; after `setCutStatus(id, 'submitted')` a re-prepare throws with a message naming `force`; the brief callback's text lands in `briefMd`.
- [ ] Run, expect failure. Implement. Run, expect pass, typecheck, lint.
- [ ] Commit: `feat: a cut is prepared from the pool with its tiles, its brief and its thin flag`.

### Task 6: The board accepts a cut (jobs-reel-plugin)

**Files (plugin repo):** modify `lib/schema/jobs.ts` (`week` regex accepts day keys; `source` becomes `z.discriminatedUnion('kind', [sheet, studio])` where studio is `{ kind: 'studio', cutId: number, pulledAt: string }`), `app/api/weeks/[week]/run/route.ts` and `lib/board/weeks.ts` (`SAFE_WEEK` accepts both keys), `lib/board/openapi.ts` (the new path); create `app/api/weeks/[week]/jobs/route.ts`; tests `tests/board.jobs.test.ts`, extend `tests/schema.jobs.test.ts`.

- [ ] Test (plugin, vitest 2): POST with a valid body writes `weeks/<key>/jobs.json` and `brief.md` under a temp root and answers `{ ok: true, week, counted, rejected }`; a body failing the schema answers 400 with the first issue; a week with `export/reel.mp4` answers 409 unless `force`; a day key `2026-09-03` is accepted; `board.openapi.test.ts` passes with the path documented.
- [ ] Run, expect failure. Implement. The route reads `process.cwd()` as root like its siblings. Run `npm test` and `npm run typecheck` in the plugin.
- [ ] Commit in the plugin: `feat: the board accepts a cut from the studio, and a day is a valid period`.

### Task 7: Submit and record

**Files:** modify `lib/jobs/board.ts` (`submitJobs`), `lib/knowledge/spaces/jobs.ts` (`recordCut`); create `lib/jobs/submit.ts`, `app/api/jobs/cuts/[id]/submit/route.ts`; test `tests/jobs.submit.test.ts`, extend `tests/jobs.board.test.ts`, `tests/knowledge.jobs.test.ts`.

**Produces:**

```ts
submitJobs(key, body: JobsFile & { brief?: string; force?: boolean }, opts?): Promise<{ ok: boolean; counted?: number; rejected?: number; message?: string; status: number }>
submitCut(id, { force }): Promise<{ submission: Submission; cut: Cut }>   // post → record → summarise → record → plan → record → recordCut
recordCut(cut: Cut, pullId: number | null): Promise<void>   // Cut node, FROM_POOL edge to Week
POST /api/jobs/cuts/[id]/submit { force? } → { submission, cut }
```

- [ ] Test: a `thin` cut without `force` is refused before any call; a successful submit records three replies and ends `planned`; a 409 from the board ends `failed` with the message in the submission; `recordCut` merges `Cut {periodKey, kind}` and `Cut -[:FROM_POOL {pullId}]-> Week` (fake graph).
- [ ] Run, expect failure. Implement. Run, expect pass, typecheck, lint.
- [ ] Commit: `feat: a cut is submitted to the board, summarised and planned, and every reply is kept`.

### Task 8: The page

**Files:** create `components/jobs/PoolPane.tsx`, `components/jobs/CutsPane.tsx`, `components/jobs/CutView.tsx`; modify `app/jobs/page.tsx`; test `tests/jobs.page.test.tsx`.

- [ ] Test (mocked fetch, router mocked): the page renders Pool counts and "Pull now"; "Prepare week" posts `{ kind: 'weekly' }` and the new cut appears in the Cuts table with its status tag; clicking a cut shows tiles from `summary`, the rows table with `mappedBy`, rejects with reasons, and a Submit button disabled while `thin` unless force is ticked; the board's weeks table is still there.
- [ ] Run, expect failure. Implement with antd `Statistic`, `Table`, `Tag`, `Alert`, `Checkbox`; plugin activity notifications already cover progress. Run, expect pass, typecheck, lint.
- [ ] Look: `/jobs`, pull, prepare week, open the cut, submit; watch the board's week appear in the fourth pane.
- [ ] Commit: `feat: the jobs page pulls the pool, prepares cuts, and submits them to the board`.

### Task 9: Manifest, docs, live proof

- [ ] `docs/implementation.json`: entry `jobs-bridge`, status `built`, files and tests above; the `jobs-tab` entry's summary mentions the bridge.
- [ ] `docs/STATE.md`: a "Jobs bridge" block with the loop and the ledger tables.
- [ ] Live: pull, prepare this week, submit with force if thin, confirm the board shows the week with source `studio`, `weeks/<key>/brief.md` exists, and `MATCH (c:Cut) RETURN count(c)` is 1.
- [ ] Commit: `docs: the jobs bridge is built`.

## Self-review

Spec coverage: pull → Task 2; prepare, map, thin, brief → Tasks 3, 4, 5; submit, record, Cut node → Task 7; board endpoint and day keys → Task 6; page → Task 8; tables and settings → Task 1; tests including the schema parity and the plugin's OpenAPI rule → Tasks 3, 6; live proof → Task 9. Placeholders: none. Types: `Cut`, `CutRow`, `Submission` from Task 1 used unchanged in 5, 7, 8; `JobsFile` from Task 3 used by 4, 6 (plugin side has its own), 7; `PoolFilter` from Task 2 used by 5.
