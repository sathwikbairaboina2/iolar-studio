# Reel patterns: sections over script lines, rendered by the templates service

**Date:** 3 September 2026
**Status:** approved design, pre-implementation
**Context:** `main-reels-templates-plugin` (FastAPI on 26200, Remotion) renders pattern `tools`
in four themes from one JSON document (`docs/INTEGRATION.md` there). Its design says
"iolar-reels will be changed to call it". This is that change, built so a second pattern is
one file here plus one template there.

## What it is

A reel may carry a **pattern**. A pattern reel skips beats entirely: its approved research
script is split into the pattern's sections, each section holds script line ids plus the
on-screen copy the template needs, the voice is made from the script lines, and the reel is
rendered by the templates service from a document the studio builds. Freeform reels (beats,
shots, kdenlive handoff) are untouched.

The word "pattern" moves. Today `reel.pattern` is the creator caption/pacing preset
(`armand`). That becomes `reel.style`. The section structure (`tools`) is the pattern.

## Decisions taken in brainstorming

- Final mp4 for a pattern reel comes from the templates service; it replaces shots and
  kdenlive for those reels.
- Claude writes the section copy from the approved script; the user edits it in the studio.
- Presenter clip: the lipsync talking-head by default, an uploaded clip wins when present.
- Sections hold script line ids directly. Beats are not involved in pattern reels.
- Multiple patterns are expected; the studio holds a registry of pattern definitions and
  reads names, themes, limits and defaults from the service at run time.
- The user sees the service's own preview (`/preview/{template}/{theme}?job=`) in the studio.

## 1. Data model and the rename

### Rename: creator preset becomes `style`

| Before | After |
|---|---|
| `reel.pattern: string` (`'armand'`) | `reel.style: string` |
| `patterns/armand/{pattern.json,caption.css,hook.html}` | `styles/armand/{style.json,caption.css,hook.html}` |
| `lib/reel/patterns.ts` `loadPattern`, `listPatterns`, `Pattern` | `lib/reel/styles.ts` `loadStyle`, `listStyles`, `Style` |
| `lib/reel/pattern-schema.ts` `PatternSchema`, `patternCssVars` | `lib/reel/style-schema.ts` `StyleSchema`, `styleCssVars` |
| `GET /api/reel/patterns`, `/patterns/clone`, `/patterns/css` | `/api/reel/styles`, `/styles/clone`, `/styles/css` |
| settings `reelPattern` | settings `reelStyle` |
| new-reel modal "Pattern" select | "Style" select |

Migration on read, no data rewrite step: `ReelSchema` preprocesses a legacy string `pattern`
into `style` and sets `pattern: null`; `getSettings` maps a legacy `reelPattern` key to
`reelStyle`. `styles/` is renamed in git; the clone writer targets `styles/<slug>-draft/`.

### New `reel.pattern`

```ts
pattern: z.object({
  /** A template the service lists in GET /templates. */
  name: z.string().min(1),
  /** One of that template's themes. */
  theme: z.string().min(1),
  /** Where the hook's presenter clip comes from; an uploaded clip flips this to upload. */
  presenter: z.enum(['lipsync', 'upload']).default('lipsync'),
  /** Pattern-specific; validated by the pattern definition, opaque to the reel schema. */
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  /** FNV of the script lines the sections were made from; absent until sectioned. */
  scriptHash: z.string().optional(),
  /** The last render on the service. */
  job: z.object({
    id: z.string(),
    state: z.enum(['queued', 'preparing', 'rendering', 'done', 'failed']),
    submittedAt: z.string(),
    /** FNV of the document sent, so an edit after submit is visible. */
    docHash: z.string(),
    error: z.string().nullable().default(null),
  }).nullable().default(null),
}).nullable().default(null)
```

`sections` is validated by `PATTERNS[name].SectionsSchema` wherever it is read or written
(`lib/reel/pattern/store.ts` `readSections(reel)`), never by the reel schema, so a new
pattern does not touch `schema.ts`.

### Sections for `tools`

```ts
{ kind: 'hook',   lineIds: string[], title: string, chips: string[], tease: string | null }
{ kind: 'slides', slides: [{ lineIds: string[], topic: string, points: string[], image: string | null, stats: Stat[] }] }
{ kind: 'web',    pages:  [{ lineIds: string[], url: string, label: string | null }] }
{ kind: 'cta',    lineIds: string[], keyword: string, line: string, follow: string }
```

`image` is a research evidence asset id or null. `url` is copied from a citation candidate.
Order of kinds is fixed by the template; `slides` and `web` may be absent.

**Invariant (every pattern):** every script line appears in exactly one *unit* (hook, one
slide, one page, cta); every unit holds at least one line; and the units, read in order,
list the lines in script order. `sec` is never stored.

### Pattern registry

`lib/reel/pattern/<name>.ts` exports a `PatternDef`:

```ts
type Unit = { path: string; label: string; lineIds: string[] };   // path e.g. "sections.1.slides.0"
type Limits = Record<string, number>;                              // from GET /templates
type PatternDef = {
  name: string;
  SectionsSchema: z.ZodType<Section[]>;
  prompt(input: { script: Script; candidates: Record<string, { url: string; title: string }>; brand: Brand; limits: Limits; themes: string[] }): string;
  parse(raw: string, script: Script, limits: Limits): Section[];   // throws SectionError with a field path
  units(sections: Section[]): Unit[];
  doc(input: { reel: Reel; script: Script; sections: Section[]; times: UnitTime[]; assets: AssetUrls; brand: Brand; captions: boolean }): unknown;
};
```

`lib/reel/pattern/index.ts` exports `PATTERNS: Record<string, PatternDef>` (only `tools`
today) and `availablePatterns()` which intersects `PATTERNS` with the service's template
list and returns `{ name, displayName, themes, limits, defaults }`. A template the service
does not list, or a def the studio lacks, is not offered.

## 2. Pipeline and stages

`lib/reel/pattern/run.ts` derives the stage from disk and advances one step, the shape of
`lib/reel/build/run.ts`.

| Stage | Derived from | `advance` does |
|---|---|---|
| `unsectioned` | script approved, `pattern.sections` empty or `scriptHash` differs from the script | SECTION |
| `sectioned` | sections present, no `vo.mp3` | VOICE (`tts` or `supplied`, same fork as the build board) |
| `voiced` | `vo.mp3`, no words | ALIGN |
| `aligned` | words, hook has no ready presenter asset and no `presenter.mp4` | PRESENT |
| `presented` | presenter ready, `job` null or its `docHash` differs from the current document | RENDER |
| `rendering` | job `queued`/`preparing`/`rendering` | poll |
| `failed` | job `failed` | nothing; the board offers Render again |
| `done` | job `done` and `export/reel.mp4` present | nothing |

A script not yet approved is reported as `unsectioned` with `blocked: 'script not approved'`.

**SECTION.** One `runClaude` call with `PATTERNS[name].prompt(...)`. Input: the script lines
with ids and roles, each line's citation candidates as `id → url, title`, the brand, the
limits and theme list from `/templates`. Output parsed by `parse`, which checks the invariant
and the limits and throws `SectionError { path, message }`. On error the prompt is re-sent
once with the errors quoted; a second error is stored on the state (`lastError`) and the
sections are left as they were. Success writes `sections` and `scriptHash`.

**VOICE / ALIGN.** `voScript(reel, script?)` returns the script lines joined for a pattern
reel and the beat text for a freeform one; `scriptHash` follows the same fork. Alignment is
unchanged (`alignVoice` with the script text). `lib/reel/pattern/timing.ts` `lineSpans`
maps words to lines with `alignTokens` (the existing Needleman-Wunsch), so a mishearing
stays local.

**PRESENT.** If `presenter.mp4` exists, skip. Else cut the hook unit's span from `vo.mp3`
into `pattern/hook.mp3` and submit it to the lipsync provider through the existing
`videoProvider('lipsync')` with the settings presenter image; the asset is added to
`reel.assets` (`origin: 'plugin'`, `provider: 'lipsync'`) and its id stored on the hook
section as `assetId`. Polling reuses `refreshShots`-style status updates on that one asset.
Lipsync unavailable leaves the stage at `aligned` with `blocked: 'lipsync down; upload a clip'`.

**RENDER.** `buildDocument(slug)` → `service.validate(doc)`; a 422 becomes
`SectionError[]` mapped by `loc` to unit paths and surfaces on the board, no job created.
Then `service.submit(doc)` and `job` is written with `docHash`. Polling every 5 s (board) or
on each `GET .../pattern`: state mirrored into `job`; on `done` the mp4 is downloaded to
`export/reel.mp4` (the existing `exported` status), timeline saved to `pattern/timeline.json`.

**Timing (`lib/reel/pattern/timing.ts`, pure).**
`unitTimes(units, lineSpans, voSec, opts)`: unit i starts at the first word of its first
line minus `leadSec` (0.25), the first unit starts at 0, the last unit ends at `voSec`;
boundaries are monotonic and frame-rounded. Each `sec` is clamped to `[secMin, secMax]` from
the template; a unit that needs more than `secMax` throws `UnitTooLong(unit, sec)` naming
the unit, never a trim. With no words yet, each unit takes the template default for its
kind so `/validate` can preview.

**Staleness.** `pattern.scriptHash` vs the script → "script changed since these sections".
`job.docHash` vs `hash(buildDocument())` → "document changed since this render". The board
shows both; nothing is discarded automatically.

## 3. Presenter, assets, document, service

**Presenter clip.** Default `lipsync` as above. Upload: `PUT /api/reel/[slug]/presenter`
(raw bytes, 100 MB cap, `mp4`/`mov`/`webm`) writes `presenter.mp4` and sets
`pattern.presenter = 'upload'`; `DELETE` removes it and returns to `lipsync`. The service
trims a clip longer than the hook from the start, so nothing is trimmed here.

**Slide images.** Default: the first image-kind evidence asset among the slide's lines'
`assetIds`, else null. Editable in the board (pick among the lines' evidence, or clear).

**Web pages.** `url` is copied verbatim from the cited candidate the model picked by id; a
url the model typed that matches no candidate is a `SectionError`.

**Document.** `tools.doc()` produces exactly the service contract:

```jsonc
{ "template": "tools", "theme": "<theme>", "ratio": reel.ratio, "fps": reel.fps,
  "brand": { "handle": settings.handle (≤24), "name": settings.brand (≤24) },
  "sections": [ hook{sec, presenter: file://…, title, chips, tease},
                slides{slides:[{sec, topic, points, image: file://…|null, stats}]},
                web{pages:[{sec, url, label}]},
                cta{sec, keyword, line, follow} ],
  "vo": { "file": "file:///…/vo.mp3", "words": [{w,start,end}] },
  "captions": { "enabled": <checkbox, default false> },
  "music": { "file": null, "gainDb": -18, "duckDb": -12 } }
```

Every asset URL is `file://` + an absolute path under the reel directory (`lib/paths.ts`
gains `reelPresenterFile`, `reelPatternDir`). `docHash` is FNV over the JSON.

**Service client** `lib/reel/pattern/service.ts`: `templates()`, `validate(doc)`,
`submit(doc)`, `job(id)`, `download(id, dest)`, `log(id)`, `previewUrl(name, theme, jobId?)`.
Base URL `REELS_TEMPLATES_URL`, default `http://127.0.0.1:26200`. Reads time out at 8 s,
submit at 30 s. Connection failures throw `ServiceDown` (message names the base). 422 bodies
are parsed into `{ loc, msg }[]`. `templates()` is cached for 60 s.

**Plugins card.** `lib/plugins/registry.ts` gains `templates` (label `reels-templates`,
port 26200, health `/health`, open `/docs`, start `.\run.ps1` in
`plugins/main-reels-templates-plugin`).

## 4. Studio UI

**New reel modal** (`app/reel/page.tsx`): a Pattern select above Style: `Freeform (beats)`
plus each entry from `GET /api/reel/patterns` (the new route: `availablePatterns()`), each
with a theme sub-select. Service down: only Freeform, with a one-line note. `POST /api/reel`
accepts `{ title, style, pattern: { name, theme } | null }`.

**Reel page** (`app/reel/[slug]/page.tsx`): when `reel.pattern` is set the tabs are Research,
Voice, Pattern, Files, Presenter. Build, Shots, Editor, Pages, Agent are not rendered.
Freeform reels are unchanged.

**Pattern tab** `components/reel/PatternBoard.tsx`:

1. Stage steps Section → Voice → Align → Presenter → Render → Done, one "next" button, the
   TTS/uploaded voice radio reused from BuildBoard; blocked reasons shown inline.
2. Theme picker (from `/templates`); changing it after a render marks the job stale.
3. Section editor: one card per unit in template order. Script lines as read-only chips.
   Copy fields with live `n/limit` counts, red when over. Slides can be added or removed;
   a line can be moved to the previous or next unit with arrow buttons (order is kept by
   construction); a unit emptied of lines is removed unless required. Image picker over the
   slide's evidence images; page URL picker over the page's citations. "Re-section with
   Claude" re-runs SECTION and replaces the sections.
4. Timing strip from `POST /validate`: units as proportional blocks with seconds; labelled
   "defaults until the voice is aligned" before ALIGN; over-limit units red with the message.
5. Presenter row: source, asset status, upload drop, clear.
6. Render row: Render, progress from the job, error + "open log" on failure, preview iframe
   `service.previewUrl(name, theme, job.id)` once a job exists, "open preview" link, and on
   done the player switches to `export/reel.mp4`.

Routes:

| Route | Does |
|---|---|
| `GET /api/reel/patterns` | `availablePatterns()` |
| `GET /api/reel/[slug]/pattern` | stage, blocked reason, sections, units with timing (from validate when possible), staleness flags, job, preview url |
| `POST /api/reel/[slug]/pattern` | `{ theme?, presenter?, sections?, captions? }` edits; sections validated by the def |
| `POST /api/reel/[slug]/pattern/section` | run SECTION (Claude) |
| `POST /api/reel/[slug]/pattern/advance` | `{ voice?: 'tts' | 'supplied' }` one step |
| `POST /api/reel/[slug]/pattern/render` | RENDER regardless of stage (re-render) |
| `PUT/DELETE /api/reel/[slug]/presenter` | hook clip upload |

Writes go through `saveReel` and the existing history/bus so the SSE stream carries them.

## 5. Errors

| Where | What | Shown as |
|---|---|---|
| SECTION | line missing/duplicated, units out of order, copy over limit, url not a candidate | retried once with the errors quoted; then `lastError` on the board, sections unchanged |
| Timing | unit over `secMax` | red unit, "slide 2 needs 34 s; split it", no render |
| Service | down | `ServiceDown`: "reels-templates is not answering on …; start it from Plugins" |
| Service | 422 on validate | field errors mapped to unit paths on the cards |
| Service | 503 missing tools | the `missing` list verbatim |
| Service | job failed | `error` on the board, "open log" |
| Presenter | lipsync down | stage stays `aligned`, blocked reason, upload offered |
| Staleness | script or document changed | flags on the board; the user re-sections or re-renders |

## 6. Testing

- `tests/reel.pattern.schema.test.ts`: legacy `pattern: 'armand'` → `style`, `pattern: null`;
  new block round-trips; settings key migration.
- `tests/reel.pattern.tools.test.ts`: prompt carries ids, urls, limits; `parse` rejects each
  invariant break and over-limit field with the path; `units` order; `doc` validates against
  the service's zod copied as a test fixture and uses only `file://` URLs.
- `tests/reel.pattern.timing.test.ts`: spans from words, lead, frame rounding, clamps,
  `UnitTooLong` names the unit, defaults without words.
- `tests/reel.pattern.run.test.ts`: stage derivation for every state; each advance with
  mocked Claude, TTS, whisper, lipsync, service; staleness flags; blocked reasons.
- `tests/reel.pattern.service.test.ts`: fake fetch; 422 mapping; submit/poll/download;
  `ServiceDown`; templates cache.
- `tests/api.reel.pattern.test.ts`: routes, including presenter upload.
- `tests/reel.patternboard.test.tsx`: cards, live counts, move a line, over-limit blocks
  Render, preview iframe carries the job id, tabs hidden for pattern reels.
- Rename sweep: `reel.patterns`, `reel.plan`, `reel.player`, `reel.onetake`, `reel.wholeclip`
  updated to `style`; whole suite green.
- `RUN_E2E=1` only: against the live service with fixture presenter and vo — section a real
  approved script, validate, render, mp4 lands in `export/`.

## Out of scope

- A second pattern (the registry is ready; none is defined).
- Music selection, stats authoring beyond what Claude fills, caption styling in the service.
- Migrating existing freeform reels to a pattern.
- Any change to the templates service itself.
