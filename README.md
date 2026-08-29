# instastudio

Local studio that turns structured JSON into Instagram-ready handwritten-notes carousels (category **handbooks**), with an AI revise chat and optional ComfyUI polish. Four more categories (reels, stories, quote cards, memes) are scaffolded for later build cycles.

Spec: `docs/superpowers/specs/2026-08-29-iolar-type1-notes-carousels-design.md`
Plan: `docs/superpowers/plans/2026-08-29-paperbook-generator.md`

## Quickstart

```bash
npm install
npx playwright install chromium
npm run dev          # http://localhost:3100 (port 3000 is the local media server)
npm test             # full suite (includes real-Chromium render tests)
```

Requirements:
- Node 20+, Windows paths assumed in defaults
- `claude` CLI on PATH (AI revise chat; app works without it, chat returns 503)
- ComfyUI Desktop on `127.0.0.1:8188` (polish + doodle assets; app works without it)

## Pipeline

```
topic  OR  reference image URLs
  -> PLAN     Claude writes data/paperbook/<slug>/post.json
              (New post modal: "AI from topic" | "AI from reference images" | blank;
               reference mode downloads the images to <slug>/refs/, reads them with
               vision, and writes FRESH original slides on the same topic/arc)
  -> RENDER   post.json + templates/<name> -> renders/slide-NN.png   (deterministic, seeded)
  -> POLISH   optional ComfyUI img2img (denoise ~0.12), jobs visible in Desktop app
  -> PACKAGE  export/01.png..NN.png + caption.txt
```

Pages are laid out as a packed two-column grid (three for `sticky-wall`): each block is
measured in the browser at full and column width, wide tables and diagrams span the page,
short blocks pair off, and headings bind to the block below them. Anything that does not fit
reflows onto a continuation page — the new slide array is written back to `post.json` and an
AI pass rewrites the titles.

Hard rules: text is never shrunk to fit; AI edits always go through diff-approve; renders are
pixel-deterministic per seed. The **10-slide** limit is advisory — the UI warns past it.

## Template authoring

A template is a directory under `templates/<name>/`:

- `template.html` — full page with three markers: `<!--HEAD-->` (shared css links injected), `<!--CONTENT-->` (block HTML), `<!--PAGEVARS-->` (`window.PAGE = {brand,date,series,page_title,pageNum,pageCount,seed,width,height}`). Must load `../_shared/rough.min.js` + `../_shared/jitter.js` and call `applyJitter(PAGE.seed + PAGE.pageNum)`.
- `manifest.json` — `{ name, displayName, inks: {blue,red,green,black,accent}, supports: [...], contentSelector }`.

Style the block classes `.b-heading .b-paragraph .b-bullets .b-sidebox .b-table .b-code .b-diagram .b-callout .b-qa`. Elements with `data-jitter` get per-character wobble; `data-rough="<color>"` gets a hand-drawn rough.js frame (hide with `svg{display:none}` if the template has native frames). Use `vh/vw` units — pages render at 2× and downscale.

Gotcha: never use `display:table` on jittered text (whitespace collapses); use `display:block;width:fit-content`.

## Golden render tests

`npm test` re-renders `tests/fixtures/golden-post.json` with every template and byte-compares against `tests/golden/*.png`. After intentional visual changes:

```bash
node scripts/approve-goldens.mjs   # regenerate
# inspect tests/golden/*.png, then commit them
```

## Data layout

```
data/handbooks/<subject>/subject.json                     # name, emoji, description
data/handbooks/<subject>/<chapter>/chapter.json           # title
data/handbooks/<subject>/<chapter>/book.json              # the syllabus, owned by the chapter
data/handbooks/<subject>/<chapter>/references.json        # reference URLs, owned by the chapter
data/handbooks/<subject>/<chapter>/refs/ref-NN.jpg        # downloaded reference pages
data/handbooks/<subject>/<chapter>/parts/<NN>/post.json   # one carousel, <=10 pages
data/handbooks/<subject>/<chapter>/parts/<NN>/renders/    # slide-NN.png + render-report.json
data/handbooks/<subject>/<chapter>/parts/<NN>/export/     # final package
data/settings.json                                        # brand, defaults, comfy url/checkpoint
assets/doodles/                                           # ComfyUI-generated sketch assets
```

Content is organised **Subject → Chapter → Part**. A chapter owns one book and one reference
list; its parts are the successive carousels that publish that book. When a part renders past
the 10-image limit the surplus becomes the next part of the same chapter — content is never
trimmed to fit. `npx tsx scripts/migrate.mts` moves a legacy `data/paperbook/` tree into this
layout, and `npx tsx scripts/reindex.mts` rebuilds the SQLite index and knowledge graph.
