# Grid Layout Engine — Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Supersedes:** the single-column layout assumption in `2026-08-29-iolar-type1-notes-carousels-design.md` §5

## 1. Problem

Pages are laid out as one vertical column, so a slide holds roughly 50 rendered lines. The reference pages use a two-column grid and hold roughly twice that. After the book stage started producing 12–15 blocks per chapter, every slide of the demo post overflowed: fill 161–203%, overflow 1.7k–2.8k px on all ten slides. The content is correct; the layout cannot hold it, and half of each page's horizontal space is wasted.

## 2. Layout model

A page is a **CSS grid** with `maxColumns` columns, declared per template in `manifest.json` (default 2; `sticky-wall` may use 3). Each block is placed at one of two widths:

- **full** — spans every column. Forced for: tables with 4+ headers, `diagram` blocks, and any block whose column-width height exceeds 1.6× its full-width height (the "badly squeezed" test).
- **half** — one column. Everything else: bullets, sidebox, callout, code, qa, paragraph, narrow tables.

Blocks flow in reading order, left-to-right then down. A `heading` **binds to the block that follows it**: the pair is measured and placed as a single unit so a heading can never strand at the foot of a column.

The page header (brand, series, page title) stays outside the grid, unchanged.

## 3. Packing pass

Runs inside the rendered page, in shared template JS, before the screenshot and before `applyJitter`:

1. **Measure** — each block (or bound heading+block unit) is rendered off-screen at full width and at column width; both pixel heights are recorded. Measurements are real, never estimated.
2. **Place** — walk units in order. Seat each in the current row if a column remains and the row's height allows; otherwise close the row and start a new one. Full-width units always occupy their own row.
3. **Local swap** — when a row closes with an unused column, look one unit ahead: if swapping the next two adjacent units fills the gap and both still fit, swap them. Adjacent pairs only, so narrative order barely moves.
4. **Spill** — when remaining units cannot fit the usable page height, stop; the leftovers are the spill list for this page.
5. **Report** — `fillPct` and `overflowPx` are computed against the packed grid, as today.

All randomness stays seeded, so identical input still produces identical pixels.

## 4. Auto-flow and content sync

Spill becomes a new page rather than an overflow error:

- `renderSlide` returns `{ overflowPx, fillPct, spill }`, where `spill` is the block list that did not fit.
- `renderAll` chains spill into a new slide and keeps rendering until nothing spills. The result carries the resulting slide array.
- The render API writes that array back to `post.json`, then re-indexes into SQLite and the knowledge graph, so renders and content never diverge.
- A continuation page's `page_title` is its parent's title plus ` (cont.)` as a placeholder.
- After a split, an **AI heading pass** rewrites the titles of affected pages so the sequence reads correctly. It returns a proposal through the existing diff-approve path — nothing is applied silently.

### Slide cap

`MAX_SLIDES` (10) becomes **advisory**:

- the schema no longer rejects more than 10 slides;
- the editor shows a warning tag when a post exceeds 10 ("over Instagram's 10-image limit") and the add-slide button warns instead of disabling;
- planner and revise prompts still target 10 and are told the cap is soft;
- packaging still exports every slide.

## 5. Components

| Unit | Responsibility |
|---|---|
| `templates/_shared/pack.js` | Pure packing algorithm: units with measured heights → placements + spill. No DOM writes. |
| `templates/_shared/layout.js` | DOM side: measure blocks at both widths, call the packer, apply grid placement, expose the spill list on `window`. |
| `lib/renderer/capture.ts` | Reads spill and metrics from the page; chains auto-flow in `renderAll`. |
| `app/api/paperbook/[slug]/render/route.ts` | Writes the post-split slide array back, re-indexes. |
| `lib/ai/headings.ts` | AI heading pass over split pages; returns a proposal. |
| template `manifest.json` | Declares `maxColumns` and `columnGap`. |
| template CSS | Grid container styles and `.span-full` / `.span-half` classes. |

Packing logic lives in `pack.js` so it can be unit-tested directly in Node, away from the browser.

## 6. Testing

- **Unit (`pack.js`)** — full-width forcing, heading binding, pairing, the swap rule, the spill boundary, determinism given identical inputs.
- **Render e2e** — every template renders the golden fixture and a dense 15-block slide; after auto-flow, assert `overflowPx === 0` and `fillPct` between 85 and 100 on all but the final page of a chain.
- **Goldens** — all 24 regenerate once (the layout intentionally changes every page), get inspected, then lock again.
- **Determinism** — the existing byte-identical re-render test must still pass.
- **Sync** — rendering a post that splits must leave `post.json`, the renders directory, and the SQLite `posts.slide_count` agreeing.

## 7. Out of scope

- Three-plus column layouts for templates that do not opt in.
- Reflowing content *between* non-adjacent pages (only forward spill).
- Splitting a single block across pages — a block always moves whole.
- Part-2 post generation for content that exceeds the soft cap.

## 8. Decisions log

| Decision | Choice |
|---|---|
| Who decides the grid | Auto-packing engine; the AI keeps writing a flat block list |
| Ordering | Reading order preserved, with adjacent local swaps |
| Overflow | Auto-flow to a new page, AI then fixes headings |
| Slide cap | Soft — warn, do not block |
| Measurement | In-page, real pixel heights at both widths |
