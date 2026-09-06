# Handbook Blocks — Sets 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the AWS-notes and DBMS-notes reference styles: real logos and icons, icon cards, service/schema/ER/chain/side-by-side-table diagrams, cover pages, hero icons, and two new families, then prove it end to end on both reference sets.

**Architecture:** Same shape as the first plan. Icons come from three packages resolved by one module. New diagram kinds are pure HTML from `lib/renderer/diagrams.ts` with browser overlays in `templates/_shared/diagrams.js` for lines that need measured positions. Slide-level fields flow through `page.ts` into the template as `PAGE` vars and a cover renderer. Families are two new template directories.

**Tech Stack:** as before, plus `aws-icons`, `simple-icons`, `lucide-static` (already installed).

**Spec:** `docs/superpowers/specs/2026-09-06-handbook-blocks-design.md` §14.

## Global Constraints

- Work in worktree `C:\Users\sathwik\projects\comfyui-projects\iolar-reels` on `feat/knowledge-layer` (the user merged the first branch here); stage named files only.
- `iconSvg()` never throws; unknown names render `''`.
- Client components must not import anything that touches `fs` (`inline.ts` stays pure; icons are injected through an option).
- Every new schema field optional; all stored posts still validate.
- Tests: `npx vitest run <files>`; full suite `npx vitest run --maxWorkers=2`; goldens `node scripts/approve-goldens.mjs` after intentional visual changes.
- Commit after each task with the trailer used so far.

## Tasks

### Task 1: Icons module
Files: create `lib/renderer/icons.ts`, `tests/icons.test.ts`; modify `package.json` (deps already added).
- `resolve(name)` → `{ source: 'aws'|'brand'|'ui', file, color? }` via prefix, alias map, then fallbacks.
- `iconSvg(name)` reads the SVG once (cache), strips `<?xml`/`<title>`, sets `class="ic ic-<source>"`, `width/height="1em"`; brand icons get `fill="#<hex>"` from `simple-icons` exports; lucide keeps `stroke="currentColor"`.
- `ICON_VOCAB: string[]` = alias keys.
- Tests: `ec2` → contains `#ed7100`; `docker` → contains simple-icons docker hex; `lock` → `stroke="currentColor"`; `aws` → AWSCloud path; `nope` → `''`; `aws:res:AmazonEC2Instance` resolves; every `ICON_VOCAB` name resolves to non-empty.

### Task 2: Primitives
Files: `lib/schema.ts` (pink ink, checkbox/star styles), `lib/renderer/inline.ts` (`{icon:name}` with resolver option, strip), `lib/renderer/blocks.ts` (pass `iconSvg`, glyph classes), `templates/_shared/base.css` (`.ic` sizing, pink fallback, `.bl-checkbox`, `.bl-star`, `.co-cloud` rough), `templates/_shared/jitter.js` (`cloud` shape: scalloped path around the rect), all 9 manifests (pink), tests in `inline.test.ts`, `blocks.test.ts`, `schema.test.ts`, `templates.test.ts`.

### Task 3: `chain` and `tables` diagrams
Files: `lib/schema.ts`, `lib/renderer/diagrams.ts`, `lib/renderer/blocks.ts` (`forcesFullWidth`), `templates/_shared/base.css`, `tests/diagrams.test.ts`, `tests/schema.test.ts`.

### Task 4: `schema` and `er` diagrams
Files: as Task 3 plus `templates/_shared/diagrams.js` (`drawSchemaLinks`, `drawErLines` called from `layout.js` next to `drawFlowchartEdges`), `tests/flowchart.edges.test.ts` (add structure tests for both overlays).

### Task 5: `flowchart` and `cards` extensions
Files: `lib/schema.ts` (title, icon, shape icon; cards icon/code/chain/text, max 6), `lib/renderer/diagrams.ts`, `templates/_shared/diagrams.js` (horizontal same-row edges, left-margin back-edges), `templates/_shared/base.css`, tests.

### Task 6: Slide-level hero, subtitle, cover
Files: `lib/schema.ts` (`hero`, `subtitle`, `kind`, `cover`; blocks min 0 for cover), `lib/renderer/page.ts` (PAGE.hero svg, PAGE.subtitle, cover HTML, `cover` class), `lib/renderer/blocks.ts` (`renderCover`), `templates/_shared/base.css` (`.cover-*` defaults, `#v-hero`), all templates get `<span id="v-hero"></span>` + `<span id="v-subtitle"></span>` hooks (harmless where unstyled), `lib/renderer/capture.ts` (`renderAll` keeps a cover slide as its own page: never merged, never spilled into), tests (`schema`, `blocks`, `fit` for `mergeContinuations`).

### Task 7: Families `sketchnote` and `marker-notes`
Files: `templates/sketchnote/{template.html,manifest.json}`, `templates/marker-notes/{…}`, `lib/schema.ts` `TEMPLATES`, `tests/templates.test.ts`, `tests/render.e2e.test.ts` family lists. Smoke-render a page of each with the kitchen-sink-2 content and eyeball.

### Task 8: Planner and editor lists
Files: `lib/ai/plan.ts` (`SCHEMA_RULES` additions, `ICON_VOCAB`, second recipe, cover rule), `components/editor/BlockForm.tsx` (option lists from schema), `tests/plan.rules.test.ts`.

### Task 9: Kitchen sink 2, goldens, full suite
Files: `tests/render.e2e.test.ts` (kitchen sink 2 on `sketchnote`, `marker-notes`, `study-sheet`), `tests/golden` (re-approve), full suite green.

### Task 10: End to end on sets 2 and 3
Studio on 3120, Claude provider: subject `aws` chapter `complete-notes` with the 16 URLs on `sketchnote`; subject `dbms` chapter `fundamentals` with the 10 URLs on `marker-notes`. Book → slides → render; inspect; fix what the renders reveal; show in Chrome; send PNGs.
