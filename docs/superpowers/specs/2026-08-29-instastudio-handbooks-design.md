# instastudio — Handbooks Hierarchy & UI Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Supersedes:** the flat `paperbook/<slug>` model and Midnight Studio shell in `2026-08-29-iolar-type1-notes-carousels-design.md` §3

## 1. Problem

Content is stored as a flat list of posts (`data/paperbook/<slug>/`), and a post that outgrows the carousel becomes a sibling post named `<slug>-part-2` with no structural link — the relationship survives only as a graph edge and a naming convention. There is no notion of a subject, so twenty-three chapters across Python, SQL and System Design sit in one undifferentiated list. The product is also being renamed, and the UI should match the companion app (instascraper) rather than diverge from it.

## 2. Naming

The product is **instastudio**. The repository directory, package name, page titles, README and UI strings change from `iolar-studio` / "iolar studio". The **brand handle stays `iolar`** — that is what prints on the rendered pages and is configured in Settings, and it is unrelated to the app's name.

## 3. Hierarchy

```
Handbooks
└── Subject            e.g. Python, SQL, System Design   (emoji, description)
    └── Chapter        e.g. Data Structures — Deep Dive  (book + references live here)
        └── Part       one Instagram carousel, ≤10 pages (post.json + renders + export)
```

A chapter owns exactly one book and one reference list; its parts are the successive carousels that publish that book. Overflow creates part 2, part 3 … inside the same chapter rather than a sibling chapter.

### Storage

```
data/handbooks/<subject>/subject.json          { name, emoji, description, created }
data/handbooks/<subject>/<chapter>/chapter.json{ title, created }
data/handbooks/<subject>/<chapter>/book.json
data/handbooks/<subject>/<chapter>/references.json
data/handbooks/<subject>/<chapter>/refs/ref-NN.jpg
data/handbooks/<subject>/<chapter>/parts/<NN>/post.json
data/handbooks/<subject>/<chapter>/parts/<NN>/renders/
data/handbooks/<subject>/<chapter>/parts/<NN>/export/
```

`<subject>` and `<chapter>` are slugs (`[a-z0-9-]+`); `<NN>` is zero-padded from `01`.

### Migration

A one-shot script moves the existing tree and is idempotent:

- `data/paperbook/python-data-structures` → `data/handbooks/python/data-structures/parts/01`
- `data/paperbook/python-data-structures-part-2` → `.../data-structures/parts/02`
- chapter-level `book.json`, `references.json`, `refs/` are lifted out of part 01
- `subject.json` is written with a title-cased name and a default emoji, editable afterwards
- the SQLite index is rebuilt from the moved files

Any `paperbook/<slug>` that does not match the `-part-N` convention becomes `handbooks/misc/<slug>/parts/01`.

## 4. API

Chapter-scoped resources sit on the chapter; page-producing operations sit on the part.

| Route | Verbs | Purpose |
|---|---|---|
| `/api/handbooks` | GET, POST | list subjects (with counts); create subject |
| `/api/handbooks/[subject]` | GET, POST | list chapters; create chapter |
| `/api/handbooks/[subject]/[chapter]` | GET, PUT | chapter meta + its parts; rename |
| `…/[chapter]/book` | GET, PUT, POST | book read/save; `generate` and `revise` |
| `…/[chapter]/references` | GET, PUT | reference URLs |
| `…/[chapter]/parts/[part]` | GET, PUT | the part's `post.json` |
| `…/[chapter]/parts/[part]/render` | GET, POST | render pages; PNG bytes by `?slide=` |
| `…/[chapter]/parts/[part]/plan` | POST | `{}` pages-from-book, `fit`, `densify`, `headings` |
| `…/[chapter]/parts/[part]/revise` | GET, POST | AI chat + diff proposals |
| `…/[chapter]/parts/[part]/package` | POST | export folder |
| `…/[chapter]/parts/[part]/polish` | POST | ComfyUI pass |
| `/api/graph`, `/api/assets`, `/api/settings`, `/api/comfy/status` | unchanged | |

Spillover changes target: surplus pages create `parts/<next>` in the same chapter instead of a `-part-2` post.

## 5. Knowledge graph

Node types become `subject`, `chapter`, `topic` (parts are not nodes — they are rendering units of a chapter). Edges: `has_chapter` (subject→chapter), `covers` (chapter→topic), `shares_topic` (chapter↔chapter). SQLite tables `subjects`, `chapters`, `parts` replace `posts`; `renders` and `refs` gain a chapter key.

## 6. UI

antd themed with instascraper's tokens, **light by default** with a dark toggle:

| token | light | dark |
|---|---|---|
| `colorPrimary` | `#e1306c` | `#e1306c` |
| ground | `#ffffff` | `#000000` |
| surface / `colorBgContainer` | `#fafafa` | `#121212` |
| text | `#000000` | `#f5f5f5` |
| success | `#1a9e4b` | `#25d366` |

Primary buttons, active nav items, chapter number badges and progress bars paint the Instagram sweep `linear-gradient(135deg,#fcb045,#fd1d1d,#833ab4)`; solid magenta carries borders, focus rings and chips, matching how instascraper reconciles the gradient with antd's single `colorPrimary`.

### Shell

A 232px **sidebar** replaces the top navigation, grouped **Create** (Handbooks, Reels, Stories, Quote cards, Memes — the last four disabled with a "soon" tail) and **Library** (Knowledge graph, Assets, Settings), with the ComfyUI status and VRAM bar pinned to its foot. The top bar keeps only breadcrumbs, search, and the theme toggle.

### Screens

1. `/handbooks` — stat row, subject cards (chapters, pages, fill bar), new-subject card
2. `/handbooks/[subject]` — chapter rows: number badge, title, points and average fill, `part 1 ⛓ part 2` chips, status, page thumbnails, open
3. `/handbooks/[subject]/[chapter]` — the editor, with a **part switcher** above the page chips; block list left, page preview right; Book, References, Polish, Render and Review actions
4. Book, Review, and AI-revise keep their current behaviour and move into the new shell
5. `/graph`, `/assets`, `/settings`, and a shared "coming soon" page for the four scaffolded categories

## 7. Components

| Unit | Responsibility |
|---|---|
| `lib/paths.ts` | slug helpers and every path under `data/handbooks/` |
| `lib/store.ts` | subject / chapter / part CRUD (replaces post CRUD) |
| `lib/migrate.ts` | one-shot paperbook → handbooks migration |
| `lib/graph.ts` | subject/chapter/topic nodes and edges |
| `components/AppShell.tsx` | sidebar shell, breadcrumbs, theme toggle |
| `components/ThemeProvider.tsx` | instascraper tokens, light default |
| `app/handbooks/**` | the three list/edit screens |
| existing editor panels | unchanged behaviour, new props for `{subject, chapter, part}` |

Render, pack, layout, book, fit, spillover and packaging logic are untouched apart from the paths and identifiers they receive.

## 8. Testing

- **Migration**: a fixture tree of `paperbook/x` and `paperbook/x-part-2` migrates to the expected layout, is idempotent on a second run, and leaves file contents byte-identical.
- **Store**: subject/chapter/part CRUD round-trips; part numbering increments; listing reports counts and status.
- **API**: the new routes cover the flows the old tests covered (create → read → save → render → package).
- **Graph**: a subject with two chapters sharing a topic produces `has_chapter`, `covers`, and a `shares_topic` edge.
- **UI**: sidebar renders both groups with the soon items disabled; theme toggle flips the root attribute; chapter rows show part chains.
- Existing render, pack, golden and fit suites must stay green unchanged.

## 9. Out of scope

- Reels, Stories, Quote cards and Memes implementations (scaffolded pages only)
- Moving a chapter between subjects, or merging chapters
- Publishing to Instagram
- Any change to how pages are packed, filled, or split

## 10. Decisions log

| Decision | Choice |
|---|---|
| Product name | instastudio; brand handle stays `iolar` |
| Hierarchy | Subject → Chapter → Part |
| Book and references | owned by the chapter, shared by its parts |
| Overflow | new part inside the chapter, not a sibling post |
| Navigation | left sidebar, grouped Create / Library |
| Theme | instascraper tokens, light default, dark toggle |
| Graph nodes | subject, chapter, topic (parts excluded) |
