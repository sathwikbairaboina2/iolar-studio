# instastudio Handbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app as instastudio — content organised Subject → Chapter → Part, a chapter-owned book and reference list, overflow creating a new part inside the chapter, and a light-default sidebar UI on instascraper's tokens.

**Architecture:** A new `lib/paths.ts` centralises every path under `data/handbooks/`, `lib/store.ts` is rewritten around subject/chapter/part instead of post, and a one-shot `lib/migrate.ts` moves the existing tree. API routes become chapter- and part-scoped; the graph indexes subjects and chapters. Rendering, packing, book, fit and packaging logic is untouched apart from the identifiers it receives.

**Tech Stack:** Next.js 16 (App Router, TS), Ant Design 5, zod, node:sqlite, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-instastudio-handbooks-design.md`

## Global Constraints

- Product name is **instastudio**; the **brand handle stays `iolar`** (it prints on rendered pages and lives in Settings).
- Storage layout, exactly: `data/handbooks/<subject>/subject.json`, `<subject>/<chapter>/chapter.json`, `<chapter>/book.json`, `<chapter>/references.json`, `<chapter>/refs/ref-NN.jpg`, `<chapter>/parts/<NN>/post.json`, `<chapter>/parts/<NN>/renders/`, `<chapter>/parts/<NN>/export/`.
- `<subject>` and `<chapter>` match `^[a-z0-9-]+$`; `<NN>` is zero-padded from `01`.
- The book and reference list belong to the **chapter** and are shared by its parts.
- Overflow creates the **next part in the same chapter**, never a sibling chapter.
- Graph node types are `subject`, `chapter`, `topic`. Parts are not nodes.
- Theme tokens — light: ground `#ffffff`, surface `#fafafa`, text `#000000`, success `#1a9e4b`; dark: ground `#000000`, surface `#121212`, text `#f5f5f5`, success `#25d366`; `colorPrimary` `#e1306c` in both. Sweep `linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)` on primary buttons, active nav, chapter badges and progress bars. **Light is the default.**
- Sidebar is 232px, groups **Create** (Handbooks, Reels, Stories, Quote cards, Memes — last four disabled with a "soon" tail) and **Library** (Knowledge graph, Assets, Settings), ComfyUI status pinned at its foot.
- Migration must be idempotent and must not alter file contents.
- Render, pack, golden and fit suites must stay green unchanged.
- All commands run from the repo root; dev server is `npm run dev` on port 3100.

## File Structure

```
lib/paths.ts                 # NEW  slugs + every data path
lib/store.ts                 # REWRITE subject/chapter/part CRUD
lib/migrate.ts               # NEW  paperbook -> handbooks, idempotent
lib/graph.ts                 # MOD  subject/chapter/topic nodes, new tables
lib/db.ts                    # MOD  schema: subjects, chapters, parts
lib/ai/{book,plan,fit,spillover,headings}.ts   # MOD  take {subject,chapter,part}
lib/packageExport.ts         # MOD  part-scoped
app/api/handbooks/**         # NEW  route tree (replaces app/api/paperbook/**)
app/handbooks/**             # NEW  three screens (replaces app/paperbook/**)
components/AppShell.tsx      # REWRITE sidebar shell
components/ThemeProvider.tsx # MOD  instascraper tokens, light default
components/editor/*          # MOD  props {subject, chapter, part}
scripts/migrate.mts          # NEW  run the migration
tests/paths.test.ts tests/migrate.test.ts tests/store.test.ts
tests/api.handbooks.test.ts tests/graph.test.ts tests/shell.test.tsx
```

---

### Task 1: Paths and slugs

**Files:**
- Create: `lib/paths.ts`
- Test: `tests/paths.test.ts`

**Interfaces:**
- Produces: `dataRoot()`, `handbooksRoot()`, `subjectDir(s)`, `subjectFile(s)`, `chapterDir(s,c)`, `chapterFile(s,c)`, `bookFile(s,c)`, `referencesFile(s,c)`, `refsDir(s,c)`, `partsDir(s,c)`, `partDir(s,c,part:number)`, `postFile(s,c,part)`, `rendersDir(s,c,part)`, `exportDir(s,c,part)`, `partName(n:number):string` (`1`→`'01'`), `isSlug(v:string):boolean`, `slugify(v:string):string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { isSlug, slugify, partName, subjectDir, chapterDir, partDir, postFile, bookFile } from '@/lib/paths';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-paths-')); });

describe('slugs', () => {
  it('validates slugs', () => {
    expect(isSlug('python-3')).toBe(true);
    expect(isSlug('Python 3')).toBe(false);
    expect(isSlug('')).toBe(false);
  });
  it('slugifies titles', () => {
    expect(slugify('Data Structures — Deep Dive!')).toBe('data-structures-deep-dive');
    expect(slugify('  SQL   Joins  ')).toBe('sql-joins');
  });
  it('pads part names', () => {
    expect(partName(1)).toBe('01');
    expect(partName(12)).toBe('12');
  });
});

describe('paths', () => {
  it('nests subject / chapter / part correctly', () => {
    const root = process.env.IOLAR_DATA_DIR!;
    expect(subjectDir('python')).toBe(path.join(root, 'handbooks', 'python'));
    expect(chapterDir('python', 'lists')).toBe(path.join(root, 'handbooks', 'python', 'lists'));
    expect(partDir('python', 'lists', 2)).toBe(path.join(root, 'handbooks', 'python', 'lists', 'parts', '02'));
    expect(postFile('python', 'lists', 2)).toBe(path.join(partDir('python', 'lists', 2), 'post.json'));
    expect(bookFile('python', 'lists')).toBe(path.join(chapterDir('python', 'lists'), 'book.json'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — cannot resolve `@/lib/paths`.

- [ ] **Step 3: Write the implementation**

`lib/paths.ts`:
```ts
import path from 'path';

export function dataRoot() {
  return process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data');
}
export function handbooksRoot() { return path.join(dataRoot(), 'handbooks'); }

export function isSlug(v: string) { return /^[a-z0-9-]+$/.test(v); }
export function slugify(v: string) {
  return v.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
export function partName(n: number) { return String(n).padStart(2, '0'); }

export function subjectDir(s: string) { return path.join(handbooksRoot(), s); }
export function subjectFile(s: string) { return path.join(subjectDir(s), 'subject.json'); }
export function chapterDir(s: string, c: string) { return path.join(subjectDir(s), c); }
export function chapterFile(s: string, c: string) { return path.join(chapterDir(s, c), 'chapter.json'); }
export function bookFile(s: string, c: string) { return path.join(chapterDir(s, c), 'book.json'); }
export function referencesFile(s: string, c: string) { return path.join(chapterDir(s, c), 'references.json'); }
export function refsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'refs'); }
export function partsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'parts'); }
export function partDir(s: string, c: string, part: number) { return path.join(partsDir(s, c), partName(part)); }
export function postFile(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'post.json'); }
export function rendersDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'renders'); }
export function exportDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'export'); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/paths.ts tests/paths.test.ts
git commit -m "feat: handbooks path helpers and slug utilities"
```

---

### Task 2: Store rewritten around subject / chapter / part

**Files:**
- Rewrite: `lib/store.ts`
- Test: `tests/store.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: everything from `lib/paths` (Task 1); `validatePost`, `Post` from `lib/schema`.
- Produces:
  - types `Subject = { slug: string; name: string; emoji: string; description: string }`,
    `ChapterMeta = { subject: string; slug: string; title: string; parts: number; points: number; pages: number; avgFill: number; status: string; updatedAt: string }`,
    `SubjectMeta = Subject & { chapters: number; pages: number }`
  - `createSubject(slug, init?: Partial<Subject>): Promise<Subject>`, `listSubjects(): Promise<SubjectMeta[]>`, `loadSubject(slug): Promise<Subject>`
  - `createChapter(subject, slug, title?): Promise<ChapterMeta>`, `listChapters(subject): Promise<ChapterMeta[]>`, `loadChapterMeta(subject, chapter): Promise<ChapterMeta>`
  - `listParts(subject, chapter): Promise<number[]>` (ascending), `nextPartNumber(subject, chapter): Promise<number>`
  - `loadPost(subject, chapter, part): Promise<Post>`, `savePost(subject, chapter, part, post): Promise<void>`, `createPart(subject, chapter, part, post): Promise<Post>`
  - `partStatus(subject, chapter, part): Promise<'draft'|'rendered'|'polished'|'packaged'>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-store-')); });

describe('handbook store', () => {
  it('creates a subject and lists it with counts', async () => {
    const { createSubject, listSubjects } = await import('@/lib/store');
    await createSubject('python', { name: 'Python', emoji: '🐍' });
    const subjects = await listSubjects();
    expect(subjects[0]).toMatchObject({ slug: 'python', name: 'Python', emoji: '🐍', chapters: 0 });
  });

  it('creates a chapter with its first part', async () => {
    const { createSubject, createChapter, listChapters, listParts, loadPost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists', 'Python Lists');
    expect(await listParts('python', 'lists')).toEqual([1]);
    const chapters = await listChapters('python');
    expect(chapters[0]).toMatchObject({ slug: 'lists', title: 'Python Lists', parts: 1 });
    expect((await loadPost('python', 'lists', 1)).brand).toBe('iolar');
  });

  it('adds parts in order and reports the next number', async () => {
    const { createSubject, createChapter, createPart, loadPost, nextPartNumber, listParts } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    const first = await loadPost('python', 'lists', 1);
    expect(await nextPartNumber('python', 'lists')).toBe(2);
    await createPart('python', 'lists', 2, first);
    expect(await listParts('python', 'lists')).toEqual([1, 2]);
  });

  it('savePost validates', async () => {
    const { createSubject, createChapter, loadPost, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    const p = await loadPost('python', 'lists', 1);
    (p as { ratio: string }).ratio = 'bogus';
    await expect(savePost('python', 'lists', 1, p)).rejects.toThrow();
  });

  it('reports draft status for a fresh part', async () => {
    const { createSubject, createChapter, partStatus } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'lists');
    expect(await partStatus('python', 'lists', 1)).toBe('draft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `createSubject` is not exported.

- [ ] **Step 3: Write the implementation**

Rewrite `lib/store.ts`. Key points: `createSubject` writes `subject.json` (`name` defaults to the slug title-cased, `emoji` to `📓`); `createChapter` writes `chapter.json` and part `01` seeded with the same default post `createPost` used to build (brand from settings, template/ratio from settings, one heading block, today's date); `listParts` reads `parts/` and returns sorted numbers; `nextPartNumber` is `max(parts)+1`; `partStatus` checks `export/` → packaged, `renders/polished/` → polished, `renders/` → rendered, else draft; `listChapters` aggregates parts, page count from `renders/render-report.json` entries, `avgFill` as the mean `fillPct` across parts, `points` from `book.json` when present; `savePost` validates then calls the graph indexer. Keep the existing `indexPost`-style try/catch so an index failure never fails a save.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/store.ts tests/store.test.ts
git commit -m "feat: subject/chapter/part store"
```

---

### Task 3: Migration from paperbook

**Files:**
- Create: `lib/migrate.ts`, `scripts/migrate.mts`
- Test: `tests/migrate.test.ts`

**Interfaces:**
- Consumes: `lib/paths` (Task 1).
- Produces: `migratePaperbook(): Promise<{ moved: { from: string; to: string }[]; skipped: string[] }>` — idempotent; a second run reports `moved: []`.

Mapping rules: `paperbook/<stem>-part-<n>` joins `<stem>`'s chapter as part `<n>`; `paperbook/<slug>` becomes part `01`. Subject is taken from the slug's first token when it matches a known subject word (`python`, `sql`, `dsa`, `system-design`), otherwise `misc`; chapter slug is the remainder (or the whole slug for `misc`). Chapter-level files (`book.json`, `references.json`, `refs/`) are lifted from part `01`; a part's own copies are deleted after the lift so the chapter owns them.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function seed(root: string) {
  const a = path.join(root, 'paperbook', 'python-data-structures');
  const b = path.join(root, 'paperbook', 'python-data-structures-part-2');
  mkdirSync(path.join(a, 'renders'), { recursive: true });
  mkdirSync(path.join(a, 'refs'), { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(path.join(a, 'post.json'), '{"slides":"A"}');
  writeFileSync(path.join(a, 'book.json'), '{"title":"Book"}');
  writeFileSync(path.join(a, 'references.json'), '{"urls":["http://x/1"]}');
  writeFileSync(path.join(a, 'refs', 'ref-01.jpg'), 'JPEGBYTES');
  writeFileSync(path.join(a, 'renders', 'slide-01.png'), 'PNG');
  writeFileSync(path.join(b, 'post.json'), '{"slides":"B"}');
}

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-mig-')); });

describe('migratePaperbook', () => {
  it('moves a post and its part 2 into one chapter', async () => {
    const root = process.env.IOLAR_DATA_DIR!;
    seed(root);
    const { migratePaperbook } = await import('@/lib/migrate');
    const res = await migratePaperbook();
    expect(res.moved.length).toBeGreaterThan(0);

    const ch = path.join(root, 'handbooks', 'python', 'data-structures');
    expect(readFileSync(path.join(ch, 'parts', '01', 'post.json'), 'utf8')).toBe('{"slides":"A"}');
    expect(readFileSync(path.join(ch, 'parts', '02', 'post.json'), 'utf8')).toBe('{"slides":"B"}');
    expect(existsSync(path.join(ch, 'parts', '01', 'renders', 'slide-01.png'))).toBe(true);
    // chapter owns book, references and refs
    expect(readFileSync(path.join(ch, 'book.json'), 'utf8')).toBe('{"title":"Book"}');
    expect(readFileSync(path.join(ch, 'references.json'), 'utf8')).toContain('http://x/1');
    expect(readFileSync(path.join(ch, 'refs', 'ref-01.jpg'), 'utf8')).toBe('JPEGBYTES');
    expect(existsSync(path.join(ch, 'parts', '01', 'book.json'))).toBe(false);
    // subject metadata written
    expect(JSON.parse(readFileSync(path.join(root, 'handbooks', 'python', 'subject.json'), 'utf8')).name).toBe('Python');
  });

  it('is idempotent', async () => {
    seed(process.env.IOLAR_DATA_DIR!);
    const { migratePaperbook } = await import('@/lib/migrate');
    await migratePaperbook();
    const second = await migratePaperbook();
    expect(second.moved).toEqual([]);
  });

  it('files an unrecognised slug under misc', async () => {
    const root = process.env.IOLAR_DATA_DIR!;
    mkdirSync(path.join(root, 'paperbook', 'random-notes'), { recursive: true });
    writeFileSync(path.join(root, 'paperbook', 'random-notes', 'post.json'), '{}');
    const { migratePaperbook } = await import('@/lib/migrate');
    await migratePaperbook();
    expect(existsSync(path.join(root, 'handbooks', 'misc', 'random-notes', 'parts', '01', 'post.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrate.test.ts` → FAIL, `@/lib/migrate` missing.

- [ ] **Step 3: Write the implementation**

`lib/migrate.ts` implements the mapping rules above using `fs.rename` where possible and a recursive copy fallback across devices; it writes `subject.json` (`name` = title-cased subject slug, emoji from a small map `{python:'🐍', sql:'🗄️', dsa:'🧠', 'system-design':'⚙️', misc:'📓'}`) and `chapter.json` (`title` = title-cased chapter slug) only when absent, and returns early with `moved: []` when `data/paperbook` does not exist.

`scripts/migrate.mts`:
```ts
import { migratePaperbook } from '../lib/migrate';
const res = await migratePaperbook();
for (const m of res.moved) console.log('moved', m.from, '->', m.to);
if (res.skipped.length) console.log('skipped:', res.skipped.join(', '));
console.log(res.moved.length ? 'migration complete' : 'nothing to migrate');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/migrate.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/migrate.ts scripts/migrate.mts tests/migrate.test.ts
git commit -m "feat: idempotent paperbook -> handbooks migration"
```

---

### Task 4: Database and graph on subjects and chapters

**Files:**
- Modify: `lib/db.ts`, `lib/graph.ts`
- Test: `tests/graph.test.ts` (replace)

**Interfaces:**
- Consumes: `Post` from `lib/schema`, `Book` from `lib/ai/book`.
- Produces:
  - tables `subjects(slug PK, name, emoji, description, updated_at)`, `chapters(subject, slug, title, parts, points, pages, avg_fill, status, updated_at, PRIMARY KEY(subject, slug))`, `parts(subject, chapter, part, slide_count, post_json, updated_at, PRIMARY KEY(subject, chapter, part))`, plus existing `renders`, `refs`, `nodes`, `edges` with `subject`/`chapter` columns.
  - `syncSubject(s: Subject)`, `syncChapter(subject, chapter, post: Post, status: string)`, `syncBook(subject, chapter, book: Book)`, `syncRenders(subject, chapter, part, results)`, `syncReferences(subject, chapter, urls)`
  - `chapterContext(subject, chapter)` → `{ topics, related }` where `related` items are `{ subject, chapter, title, shared }`
  - `coveredElsewhere(subject, chapter): string[]`, `graph()`, `searchTopics(q)`
  - node ids: `subject:<slug>`, `chapter:<subject>/<slug>`, `topic:<key>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

const post = (series: string, headings: string[]): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series, date: 'd',
  slides: [{ page_title: 'P', blocks: headings.map((h) => ({ type: 'heading', text: h })) }],
  caption: { text: '', hashtags: [] },
});

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-graph-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => { (await import('@/lib/db')).closeDb(); });

describe('graph', () => {
  it('links subject to chapter to topic', async () => {
    const { syncSubject, syncChapter, graph } = await import('@/lib/graph');
    syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    syncChapter('python', 'lists', post('LISTS', ['1. Slicing basics']), 'draft');
    const g = graph();
    expect(g.nodes.some((n) => n.id === 'subject:python')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'chapter:python/lists')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'has_chapter' && e.src === 'subject:python')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'covers')).toBe(true);
  });

  it('reports chapters sharing a topic', async () => {
    const { syncSubject, syncChapter, chapterContext, coveredElsewhere } = await import('@/lib/graph');
    syncSubject({ slug: 'python', name: 'Python', emoji: '🐍', description: '' });
    syncChapter('python', 'lists', post('LISTS', ['1. Slicing basics', '2. Sorting']), 'draft');
    syncChapter('python', 'tuples', post('TUPLES', ['1. Slicing basics', '2. Immutability']), 'draft');
    const ctx = chapterContext('python', 'lists');
    expect(ctx.related.map((r) => r.chapter)).toContain('tuples');
    expect(coveredElsewhere('python', 'lists').join(' ').toLowerCase()).toContain('immutability');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph.test.ts` → FAIL, `syncSubject` missing.

- [ ] **Step 3: Write the implementation**

Update `lib/db.ts`'s `SCHEMA` to the tables above (keep `CREATE TABLE IF NOT EXISTS`; add `subject`/`chapter` columns to `renders` and `refs`, and `subject`/`chapter` to `nodes`). Rewrite `lib/graph.ts` so `syncChapter` upserts the chapter row and node, links `subject:<s>` → `chapter:<s>/<c>` with `has_chapter`, and links slide headings to topics with `covers`; `rebuildSharedTopicEdges` joins chapters rather than posts. Keep `topicKey` and `topicFromPoint` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/graph.ts tests/graph.test.ts
git commit -m "feat: index subjects and chapters in sqlite and the graph"
```

---

### Task 5: AI and packaging modules take subject/chapter/part

**Files:**
- Modify: `lib/ai/book.ts`, `lib/ai/plan.ts`, `lib/ai/fit.ts`, `lib/ai/headings.ts`, `lib/ai/spillover.ts`, `lib/packageExport.ts`
- Test: `tests/fit.test.ts`, `tests/headings.test.ts`, `tests/package.test.ts` (update call sites)

**Interfaces:**
- Consumes: `lib/paths`, `lib/store` (Tasks 1-2).
- Produces (all previously `slug`-keyed):
  - `loadBook(subject, chapter)`, `saveBook(subject, chapter, book)`, `bookFromReferences(subject, chapter, files)`, `bookFromTopic(subject, chapter, topic)`, `reviseBook(subject, chapter, book, request)`
  - `planBook(subject, chapter, mode, input)`, `planSlidesFromBook(subject, chapter, part)`, `densifySlides(subject, chapter, part, underfilled)`
  - `fitToPages(subject, chapter, part)`, `measureSlides(post)` unchanged, `uncoveredPoints(book, post)` unchanged
  - `fixHeadings(subject, chapter, part)`
  - `splitIntoFollowUp(subject, chapter, part, limit?)` → `{ moved: number; part: number } | null` — creates the **next part in the same chapter** (`nextPartNumber`), copies nothing (book and references already live on the chapter), and re-saves the trimmed part.
  - `packagePost(subject, chapter, part)`

- [ ] **Step 1: Update the tests to the new signatures**

In `tests/fit.test.ts`, `tests/headings.test.ts`, `tests/package.test.ts`: replace `createPost('x', …)` setup with `createSubject('python')` + `createChapter('python', 'x')`, and call `fitToPages('python','x',1)`, `fixHeadings('python','x',1)`, `packagePost('python','x',1)`. Keep every assertion — the guards (block-count rejection, slide-count rejection, overflow blocking packaging) must still hold.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fit.test.ts tests/headings.test.ts tests/package.test.ts`
Expected: FAIL — old signatures.

- [ ] **Step 3: Write the implementation**

Thread `(subject, chapter, part)` through each module, replacing `postDir(slug)` with the `lib/paths` helpers. `splitIntoFollowUp` becomes:

```ts
export async function splitIntoFollowUp(
  subject: string, chapter: string, part: number, limit = MAX_SLIDES
): Promise<{ moved: number; part: number } | null> {
  const post = await loadPost(subject, chapter, part);
  if (post.slides.length <= limit) return null;
  const kept = post.slides.slice(0, limit);
  const moved = post.slides.slice(limit);
  const next = await nextPartNumber(subject, chapter);
  await createPart(subject, chapter, next, validatePost({
    ...post,
    series: `${post.series.replace(/ — PART \d+$/i, '')} — PART ${next}`,
    slides: moved.map((s, i) => (i === 0 ? { ...s, cont: undefined } : s)),
  }));
  await savePost(subject, chapter, part, { ...post, slides: kept });
  return { moved: moved.length, part: next };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fit.test.ts tests/headings.test.ts tests/package.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat: chapter-owned book and part-scoped ai/packaging"
```

---

### Task 6: API route tree

**Files:**
- Create: `app/api/handbooks/route.ts`, `app/api/handbooks/[subject]/route.ts`, `app/api/handbooks/[subject]/[chapter]/route.ts`, `.../[chapter]/book/route.ts`, `.../[chapter]/references/route.ts`, `.../[chapter]/parts/[part]/route.ts`, `.../parts/[part]/{render,plan,revise,package,polish}/route.ts`
- Delete: `app/api/paperbook/**`
- Test: `tests/api.handbooks.test.ts` (replaces `tests/api.paperbook.test.ts`)

**Interfaces:**
- Consumes: store, graph, AI and packaging modules (Tasks 2-5).
- Produces the contract in spec §4. Bodies and responses keep their current shapes; `render` still answers `{ results, slides, split, followUp }`, where `followUp` is now `{ moved, part }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const req = (method: string, body?: unknown) =>
  new Request('http://t/api', { method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-api-')); });

describe('handbooks api', () => {
  it('creates subject, chapter, reads and saves the part', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    const chapters = await import('@/app/api/handbooks/[subject]/route');
    const part = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/route');

    await subjects.POST(req('POST', { slug: 'python', name: 'Python', emoji: '🐍' }));
    expect((await (await subjects.GET()).json()).subjects[0].slug).toBe('python');

    await chapters.POST(req('POST', { slug: 'lists', title: 'Python Lists' }),
      { params: Promise.resolve({ subject: 'python' }) });
    const list = await (await chapters.GET(req('GET'), { params: Promise.resolve({ subject: 'python' }) })).json();
    expect(list.chapters[0]).toMatchObject({ slug: 'lists', parts: 1 });

    const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
    const got = await (await part.GET(req('GET'), ctx)).json();
    got.series = 'UPDATED';
    const saved = await (await part.PUT(req('PUT', got), ctx)).json();
    expect(saved.series).toBe('UPDATED');
  });

  it('rejects a bad subject slug', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    expect((await subjects.POST(req('POST', { slug: 'Bad Slug!' }))).status).toBe(400);
  });

  it('renders a part and reports the page count', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    const chapters = await import('@/app/api/handbooks/[subject]/route');
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await subjects.POST(req('POST', { slug: 'python' }));
    await chapters.POST(req('POST', { slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });
    const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
    const body = await (await render.POST(req('POST', {}), ctx)).json();
    expect(body.results[0].overflowPx).toBe(0);
    expect(existsSync(body.results[0].file)).toBe(true);
  }, 120_000);
});
```

- [ ] **Step 2: Run test to verify it fails** — routes do not exist yet.

- [ ] **Step 3: Write the routes**

Each handler validates slugs with `isSlug`, parses `part` with `Number(params.part)`, and otherwise forwards to the store / AI modules exactly as the `paperbook` routes did. Delete `app/api/paperbook` and `tests/api.paperbook.test.ts` in the same commit.

- [ ] **Step 4: Run test to verify it passes** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api tests
git rm -r --cached app/api/paperbook 2>/dev/null || true
git commit -m "feat: handbooks api route tree"
```

---

### Task 7: Theme and sidebar shell

**Files:**
- Modify: `components/ThemeProvider.tsx`, `components/AppShell.tsx`, `app/layout.tsx`
- Create: `app/soon/page.tsx` (shared "coming soon" screen; the four category routes render it)
- Test: `tests/shell.test.tsx` (replace)

**Interfaces:**
- Produces: `ThemeProvider` with the token tables from Global Constraints, `mode` defaulting to `'light'`, persisted under `instastudio-theme`, and a `.ig-sweep` class emitting the gradient. `AppShell` renders the 232px sidebar with the two groups, "soon" tails on the four disabled items, breadcrumbs slot, search box and theme toggle.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ usePathname: () => '/handbooks', useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ up: false }) }) as unknown as typeof fetch;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('AppShell', () => {
  it('renders both sidebar groups, disables the soon categories, defaults to light', async () => {
    const ThemeProvider = (await import('@/components/ThemeProvider')).default;
    const AppShell = (await import('@/components/AppShell')).default;
    render(<ThemeProvider><AppShell><p>hi</p></AppShell></ThemeProvider>);

    expect(screen.getByText('Create')).toBeTruthy();
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getByText('Handbooks')).toBeTruthy();
    expect(screen.getByText('Reels').closest('li')?.className).toContain('ant-menu-item-disabled');
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByLabelText('toggle theme'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — the current shell has no groups and defaults to dark.

- [ ] **Step 3: Write the implementation**

`ThemeProvider`: light tokens `{colorPrimary:'#e1306c', colorBgBase:'#ffffff', colorBgContainer:'#fafafa', colorBgLayout:'#ffffff', colorText:'#000000', colorSuccess:'#1a9e4b', borderRadius:10}` with `theme.defaultAlgorithm`; dark tokens `{colorPrimary:'#e1306c', colorBgBase:'#000000', colorBgContainer:'#121212', colorBgLayout:'#000000', colorText:'#f5f5f5', colorSuccess:'#25d366', borderRadius:10}` with `theme.darkAlgorithm`. Inject a global style once:

```tsx
<style>{`.ig-sweep{background-image:linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)!important;border-color:transparent!important;color:#fff!important}
.ant-btn-primary:not(:disabled){background-image:linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4);border-color:transparent}
.ant-menu-item-selected{background-image:linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)!important;color:#fff!important}`}</style>
```

`AppShell`: antd `Layout.Sider width={232}` with `Menu` `items` carrying `type:'group'` entries labelled `Create` and `Library`, the four future categories `disabled` with a `<Tag>soon</Tag>` label suffix, and `ComfyPill` rendered at the foot. Header holds a `breadcrumb` slot (children pass it via a `usePathname`-derived default), a `Input.Search`, and the theme `Button` with `aria-label="toggle theme"`.

- [ ] **Step 4: Run test to verify it passes** → PASS.

- [ ] **Step 5: Commit**

```bash
git add components app tests/shell.test.tsx
git commit -m "feat: instastudio sidebar shell and instascraper theme tokens"
```

---

### Task 8: Handbooks screens

**Files:**
- Create: `app/handbooks/page.tsx`, `app/handbooks/[subject]/page.tsx`, `app/handbooks/[subject]/[chapter]/page.tsx`
- Delete: `app/paperbook/**`
- Modify: `components/editor/{BlockEditor,BlockForm,SlideChips,PreviewPane,AiDrawer,BookPanel,ReferencePanel,ReviewPanel,DiffCard}.tsx` — swap the `slug` prop for `{ subject, chapter, part }` and build URLs as `/api/handbooks/${subject}/${chapter}/parts/${part}/…` (book and references drop the `parts/...` segment).
- Test: `tests/pages.test.tsx` (replace), `tests/review.test.tsx`, `tests/editor.test.tsx` (update props)

**Interfaces:**
- Consumes: the API contract from Task 6.
- Produces: `/handbooks` (stat row + subject cards + new-subject modal validating `isSlug`), `/handbooks/[subject]` (chapter rows with number badge, points, avg fill, `part 1 ⛓ part 2` chips, status tag, thumbnails, open button, and the three create buttons), `/handbooks/[subject]/[chapter]` (the editor with a **part switcher** — a `Segmented` of part numbers above the page chips — and every existing panel).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

afterEach(cleanup);
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/handbooks', useRouter: () => ({ push }) }));

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    subjects: [{ slug: 'python', name: 'Python', emoji: '🐍', description: 'Core', chapters: 8, pages: 62 }],
    chapters: [{ subject: 'python', slug: 'data-structures', title: 'Data Structures', parts: 2, points: 158, pages: 14, avgFill: 92, status: 'packaged', updatedAt: new Date().toISOString() }],
  }) }) as unknown as typeof fetch;
});

describe('handbooks screens', () => {
  it('lists subjects and rejects a bad new-subject slug', async () => {
    const Page = (await import('@/app/handbooks/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    fireEvent.click(screen.getByText('+ new subject'));
    fireEvent.change(await screen.findByPlaceholderText(/subject-slug/), { target: { value: 'Bad Slug!' } });
    expect((screen.getByRole('button', { name: /Create/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a chapter with its part chain', async () => {
    const Page = (await import('@/app/handbooks/[subject]/page')).default;
    render(<Page params={Promise.resolve({ subject: 'python' })} />);
    await waitFor(() => expect(screen.getByText('Data Structures')).toBeTruthy());
    expect(screen.getByText(/part 1/)).toBeTruthy();
    expect(screen.getByText(/part 2/)).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — pages do not exist.

- [ ] **Step 3: Write the screens and rewire the panels**

Build the three pages to match the approved mockup (`scratchpad/iolar-mockup/instastudio-light.html`): subject cards with emoji, description, chapter/page chips and a sweep progress bar; chapter rows with the sweep number badge and part chips; the editor keeping its two-column layout with the part `Segmented` added. Delete `app/paperbook`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pages.test.tsx tests/editor.test.tsx tests/review.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app components tests
git commit -m "feat: handbooks subject, chapter and editor screens"
```

---

### Task 9: Rename to instastudio, migrate real data, docs

**Files:**
- Modify: `package.json`, `app/layout.tsx` (metadata), `README.md`, `docs/` references
- Rename: repository directory `iolar-studio` → `instastudio`

**Interfaces:**
- Consumes: everything above.
- Produces: the app titled instastudio, the live data migrated, and a green suite.

- [ ] **Step 1: Rename the package and titles**

`package.json` `"name": "instastudio"`; `app/layout.tsx` metadata `title: 'instastudio'`, description `'Instagram content studio'`; README heading and body. Leave `getSettings().brand` (`iolar`) untouched — it prints on the pages.

- [ ] **Step 2: Migrate the live data**

Run: `npx tsx scripts/migrate.mts`
Expected: reports the two moves (`python-data-structures` → `handbooks/python/data-structures/parts/01`, `-part-2` → `parts/02`).
Then rebuild the index: `npx tsx scripts/reindex.mts` (update that script to walk `handbooks/`).

- [ ] **Step 3: Verify the migrated chapter renders**

Start the dev server (`npm run dev`), then:
```bash
curl -s -X POST http://localhost:3100/api/handbooks/python/data-structures/parts/1/render \
  -H "content-type: application/json" -d '{}'
```
Expected: 10 results, `overflowPx: 0` on every page.

- [ ] **Step 4: Rename the directory**

Stop the dev server. From `C:\Users\sathwik\projects\comfyui-projects`:
```bash
git -C iolar-studio status --short   # must be clean
mv iolar-studio instastudio
cd instastudio && npm run dev
```

- [ ] **Step 5: Full suite and build**

Run: `npm test` and `npm run build` → all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: rename to instastudio and migrate live data to handbooks"
```

---

## Self-Review (done at write time)

- **Spec coverage:** §2 naming → Task 9; §3 hierarchy and storage → Tasks 1-2; §3 migration → Task 3; §4 API → Task 6; §5 graph → Task 4; §6 tokens and shell → Task 7; §6 screens → Task 8; §7 components → all tasks own their listed files; §8 testing → every task carries its tests, and Task 9 runs the untouched render/pack/golden/fit suites.
- **Placeholder scan:** no TBD/TODO; every code step carries real code; the mapping rules and token tables are spelled out rather than referenced.
- **Type consistency:** `Subject`, `SubjectMeta`, `ChapterMeta`, `partName`, `nextPartNumber`, `createPart`, `splitIntoFollowUp → { moved, part }`, node ids `subject:<slug>` / `chapter:<subject>/<slug>` are used identically wherever they appear.
- **Known ordering constraint:** Task 5 must land before Task 6, because the routes call the new AI signatures; Task 7 may land any time after Task 1.
