# Grid Layout Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay each notebook page out as a packed two-column grid driven by real measured block heights, so pages hold roughly twice the content, waste no columns, and spill cleanly onto a new page instead of overflowing.

**Architecture:** A pure packing function (`templates/_shared/pack.js`) decides placements from measured heights; a DOM driver (`templates/_shared/layout.js`) measures every block at full and column width inside the rendered page, calls the packer, applies CSS-grid placement, and publishes the spill list. `capture.ts` reads spill and chains auto-flow; the render API writes the resulting slide array back to `post.json` and re-indexes SQLite/graph; an AI pass fixes headings on split pages.

**Tech Stack:** Playwright (in-page measurement), plain ES5-compatible browser JS for template scripts, TypeScript + Next.js API routes, vitest, node:sqlite.

**Spec:** `docs/superpowers/specs/2026-08-29-grid-layout-engine-design.md`

## Global Constraints

- Page grid uses `maxColumns` from each template's `manifest.json`; default **2**, `sticky-wall` **3**.
- Full-width forced for: tables with **4 or more headers**, all `diagram` blocks, and any unit whose column-width height exceeds **1.6×** its full-width height.
- A `heading` block **binds to the block after it** and is placed as one unit.
- Reading order is preserved; only **adjacent** pairs may swap, and only when the swap fills a gap and both units still fit.
- Spill moves **whole blocks** — never split a block across pages.
- Continuation pages get `page_title` = parent title + `" (cont.)"` before the AI heading pass runs.
- `MAX_SLIDES = 10` becomes **advisory**: schema must not reject more than 10; UI warns; prompts still target 10.
- All randomness stays seeded from `post.seed`; identical input must still produce byte-identical PNGs.
- Template scripts are loaded as classic `<script>` tags in a `file://` page — no ES modules, no imports, no optional chaining beyond what Chromium supports; attach to `window`.
- `pack.js` must be requireable from Node for unit tests (guard the export: `if (typeof module !== 'undefined') module.exports = {...}`).
- All commands run from `C:\Users\sathwik\projects\comfyui-projects\iolar-studio`; dev server is `npm run dev` on port 3100.

## File Structure

```
templates/_shared/pack.js          # NEW  pure packer: units+heights -> placements+spill
templates/_shared/layout.js        # NEW  DOM: measure -> pack -> apply grid -> window.LAYOUT
templates/_shared/base.css         # MOD  grid container, .span-full/.span-half
templates/<each>/template.html     # MOD  load pack.js+layout.js, call applyLayout before applyJitter
templates/<each>/manifest.json     # MOD  add maxColumns, columnGap
lib/renderer/blocks.ts             # MOD  wrap each block in a .pk-unit element carrying its type
lib/renderer/capture.ts            # MOD  read spill; renderAll chains auto-flow
lib/schema.ts                      # MOD  MAX_SLIDES advisory (drop zod .max)
lib/ai/headings.ts                 # NEW  AI heading pass for split pages
app/api/paperbook/[slug]/render/route.ts   # MOD  persist post-split slides, re-index
app/paperbook/[slug]/page.tsx      # MOD  over-cap warning; reload post after split
components/editor/SlideChips.tsx   # MOD  warn instead of disable past 10
tests/pack.test.ts                 # NEW  packer unit tests
tests/render.e2e.test.ts           # MOD  density + auto-flow assertions
tests/golden/*.png                 # MOD  regenerate once, inspect, lock
```

---

### Task 1: Pure packing algorithm

**Files:**
- Create: `templates/_shared/pack.js`
- Test: `tests/pack.test.ts`

**Interfaces:**
- Produces: `window.packUnits(units, opts) -> { rows, spill }` (also `module.exports.packUnits` for Node).
  - `units`: `[{ index, type, boundIndexes, fullH, halfH, forceFull }]` — `index` is position in the original block list, `boundIndexes` lists every original block index the unit contains (a bound heading unit has two).
  - `opts`: `{ columns: number, pageHeight: number, rowGap: number }`
  - `rows`: `[{ items: [{ unit, span: 'full'|'half', col: number }], height: number }]`
  - `spill`: `units[]` that did not fit, in original order.

- [ ] **Step 1: Write the failing test**

`tests/pack.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require_ = createRequire(import.meta.url);
const { packUnits } = require_(path.join(process.cwd(), 'templates/_shared/pack.js'));

const u = (index: number, fullH: number, halfH: number, extra: object = {}) =>
  ({ index, type: 'bullets', boundIndexes: [index], fullH, halfH, ...extra });

describe('packUnits', () => {
  it('pairs two half-width units into one row', () => {
    const { rows, spill } = packUnits([u(0, 100, 100), u(1, 100, 100)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(spill).toEqual([]);
    expect(rows.length).toBe(1);
    expect(rows[0].items.map((i: { col: number }) => i.col)).toEqual([0, 1]);
  });

  it('forces full width when forceFull is set', () => {
    const { rows } = packUnits([u(0, 80, 80, { forceFull: true }), u(1, 80, 80)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items[0].span).toBe('full');
    expect(rows[0].items.length).toBe(1);
    expect(rows[1].items[0].unit.index).toBe(1);
  });

  it('forces full width when half-width height exceeds 1.6x full height', () => {
    const { rows } = packUnits([u(0, 100, 170)], { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items[0].span).toBe('full');
  });

  it('spills units that do not fit, whole and in order', () => {
    const units = [u(0, 400, 400), u(1, 400, 400), u(2, 400, 400), u(3, 400, 400)];
    const { rows, spill } = packUnits(units, { columns: 2, pageHeight: 900, rowGap: 10 });
    expect(rows.length).toBe(2);
    expect(spill.map((s: { index: number }) => s.index)).toEqual([]);
    const tight = packUnits(
      [u(0, 500, 500, { forceFull: true }), u(1, 500, 500, { forceFull: true }), u(2, 500, 500, { forceFull: true })],
      { columns: 2, pageHeight: 1020, rowGap: 10 }
    );
    expect(tight.spill.map((s: { index: number }) => s.index)).toEqual([2]);
  });

  it('swaps adjacent units when the swap fills a gap', () => {
    // unit 1 is full-width so it cannot pair; unit 2 is half and fits beside unit 0.
    const units = [u(0, 100, 100), u(1, 100, 100, { forceFull: true }), u(2, 100, 100)];
    const { rows } = packUnits(units, { columns: 2, pageHeight: 1000, rowGap: 10 });
    expect(rows[0].items.map((i: { unit: { index: number } }) => i.unit.index)).toEqual([0, 2]);
    expect(rows[1].items[0].unit.index).toBe(1);
  });

  it('is deterministic for identical input', () => {
    const units = [u(0, 120, 200), u(1, 90, 90), u(2, 300, 300, { forceFull: true }), u(3, 90, 90)];
    const opts = { columns: 2, pageHeight: 1000, rowGap: 10 };
    expect(JSON.stringify(packUnits(units, opts))).toBe(JSON.stringify(packUnits(units, opts)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pack.test.ts`
Expected: FAIL — cannot find `templates/_shared/pack.js`.

- [ ] **Step 3: Write the implementation**

`templates/_shared/pack.js`:
```js
// Pure block packer: decides span + column for each unit and reports what did not fit.
// Loaded as a classic script in templates and required directly by Node tests.
(function (root) {
  var SQUEEZE_LIMIT = 1.6;

  function spanOf(unit) {
    if (unit.forceFull) return 'full';
    if (unit.halfH > unit.fullH * SQUEEZE_LIMIT) return 'full';
    return 'half';
  }

  function heightOf(unit, span) {
    return span === 'full' ? unit.fullH : unit.halfH;
  }

  function packUnits(units, opts) {
    var columns = opts.columns || 2;
    var pageHeight = opts.pageHeight;
    var rowGap = opts.rowGap || 0;

    var queue = units.slice();
    var rows = [];
    var used = 0;

    while (queue.length) {
      var first = queue.shift();
      var firstSpan = spanOf(first);
      var row = { items: [{ unit: first, span: firstSpan, col: 0 }], height: heightOf(first, firstSpan) };

      if (firstSpan === 'half') {
        var col = 1;
        while (col < columns && queue.length) {
          var nextSpan = spanOf(queue[0]);
          var pickIndex = -1;
          if (nextSpan === 'half') {
            pickIndex = 0;
          } else if (queue.length > 1 && spanOf(queue[1]) === 'half') {
            // Adjacent local swap: the next unit cannot pair, the one after it can.
            pickIndex = 1;
          }
          if (pickIndex === -1) break;
          var picked = queue.splice(pickIndex, 1)[0];
          row.items.push({ unit: picked, span: 'half', col: col });
          row.height = Math.max(row.height, heightOf(picked, 'half'));
          col++;
        }
      }

      var cost = row.height + (rows.length ? rowGap : 0);
      if (used + cost > pageHeight && rows.length) {
        // Row does not fit: this row's units and everything after it spill, in original order.
        var spill = row.items.map(function (i) { return i.unit; }).concat(queue);
        spill.sort(function (a, b) { return a.index - b.index; });
        return { rows: rows, spill: spill };
      }
      used += cost;
      rows.push(row);
    }

    return { rows: rows, spill: [] };
  }

  root.packUnits = packUnits;
  if (typeof module !== 'undefined' && module.exports) module.exports = { packUnits: packUnits };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pack.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add templates/_shared/pack.js tests/pack.test.ts
git commit -m "feat: pure grid packing algorithm with spans, swaps and spill"
```

---

### Task 2: Block wrappers and grid CSS

**Files:**
- Modify: `lib/renderer/blocks.ts`
- Modify: `templates/_shared/base.css`
- Test: `tests/blocks.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: every block's HTML is wrapped as
  `<div class="pk-unit" data-block-index="N" data-block-type="TYPE" data-force-full="1"?>…existing block html…</div>`.
  `data-force-full` is present only for `diagram` blocks and tables with 4+ headers. `layout.js` relies on these attributes.

- [ ] **Step 1: Write the failing test**

Append to `tests/blocks.test.ts`:
```ts
import { renderSlideBlocks } from '@/lib/renderer/blocks';

describe('renderSlideBlocks', () => {
  it('wraps every block with index and type', () => {
    const html = renderSlideBlocks([
      { type: 'heading', text: 'H' },
      { type: 'paragraph', text: 'P' },
    ] as Block[]);
    expect(html).toContain('data-block-index="0"');
    expect(html).toContain('data-block-type="heading"');
    expect(html).toContain('data-block-index="1"');
    expect((html.match(/class="pk-unit"/g) ?? []).length).toBe(2);
  });

  it('marks wide tables and diagrams as force-full', () => {
    const wide = renderSlideBlocks([
      { type: 'table', headers: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']] },
    ] as Block[]);
    expect(wide).toContain('data-force-full="1"');

    const narrow = renderSlideBlocks([
      { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] },
    ] as Block[]);
    expect(narrow).not.toContain('data-force-full="1"');

    const diagram = renderSlideBlocks([
      { type: 'diagram', kind: 'flow', spec: { nodes: ['a'] } },
    ] as Block[]);
    expect(diagram).toContain('data-force-full="1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/blocks.test.ts`
Expected: FAIL — `renderSlideBlocks` is not exported.

- [ ] **Step 3: Write the implementation**

Add to the bottom of `lib/renderer/blocks.ts`:
```ts
function forcesFullWidth(block: Block): boolean {
  if (block.type === 'diagram') return true;
  if (block.type === 'table' && block.headers.length >= 4) return true;
  return false;
}

/** Wraps each block in a packing unit the layout engine can measure and place. */
export function renderSlideBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      const full = forcesFullWidth(b) ? ' data-force-full="1"' : '';
      return `<div class="pk-unit" data-block-index="${i}" data-block-type="${b.type}"${full}>${renderBlockHtml(b)}</div>`;
    })
    .join('\n');
}
```

Add to `templates/_shared/base.css`:
```css
#content{display:grid;grid-template-columns:repeat(var(--pk-cols,2),1fr);
  column-gap:var(--pk-col-gap,2.2vw);row-gap:0;align-items:start}
.pk-unit{grid-column:span var(--pk-cols,2);min-width:0}
.pk-unit.span-half{grid-column:span 1}
.pk-unit.span-full{grid-column:span var(--pk-cols,2)}
.pk-measure{position:absolute!important;visibility:hidden!important;pointer-events:none!important;
  top:0;left:0;z-index:-99}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/blocks.ts templates/_shared/base.css tests/blocks.test.ts
git commit -m "feat: wrap blocks as packing units and add grid CSS"
```

---

### Task 3: In-page layout driver

**Files:**
- Create: `templates/_shared/layout.js`
- Modify: `lib/renderer/page.ts`
- Modify: `templates/spiral-notes/template.html`, `templates/spiral-notes/manifest.json`

**Interfaces:**
- Consumes: `window.packUnits` (Task 1); `.pk-unit[data-block-index][data-block-type][data-force-full]` markup (Task 2).
- Produces: `window.applyLayout(opts)` where `opts = { columns, rowGapPx }`. It measures, packs, applies `span-half`/`span-full` classes plus explicit `grid-column-start`, removes spilled units from the DOM, and sets:
  - `window.LAYOUT = { spillIndexes: number[], usedPx: number, usablePx: number }`
  - `document.body.dataset.layoutDone = '1'`
  `spillIndexes` are original block indexes, ascending. `page.ts` must call `renderSlideBlocks` (Task 2) instead of joining `renderBlockHtml` itself, and inject `--pk-cols` / `--pk-col-gap` from the manifest.

- [ ] **Step 1: Write the driver**

`templates/_shared/layout.js`:
```js
// DOM side of the grid engine: measure every unit at both widths, pack, place, publish spill.
(function () {
  function measure(container, units, columns, colGapPx) {
    var width = container.clientWidth;
    var halfWidth = (width - colGapPx * (columns - 1)) / columns;
    var probe = document.createElement('div');
    probe.className = 'pk-measure';
    container.appendChild(probe);

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      probe.innerHTML = '';
      var clone = u.el.cloneNode(true);
      clone.classList.remove('span-half', 'span-full');
      clone.style.gridColumn = '';
      probe.appendChild(clone);

      probe.style.width = width + 'px';
      u.fullH = clone.getBoundingClientRect().height;
      probe.style.width = halfWidth + 'px';
      u.halfH = clone.getBoundingClientRect().height;
    }

    probe.remove();
  }

  window.applyLayout = function (opts) {
    var columns = opts.columns || 2;
    var rowGapPx = opts.rowGapPx || 0;
    var container = document.getElementById('content');
    var pageEl = document.getElementById('page');
    if (!container || !pageEl) return;

    var els = [].slice.call(container.querySelectorAll('.pk-unit'));

    // Bind each heading to the block that follows it so the pair never splits.
    var units = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var idx = parseInt(el.getAttribute('data-block-index'), 10);
      var isHeading = el.getAttribute('data-block-type') === 'heading';
      if (isHeading && i + 1 < els.length) {
        var next = els[i + 1];
        var wrap = document.createElement('div');
        wrap.className = 'pk-unit';
        wrap.setAttribute('data-block-index', String(idx));
        if (next.getAttribute('data-force-full')) wrap.setAttribute('data-force-full', '1');
        container.insertBefore(wrap, el);
        wrap.appendChild(el);
        wrap.appendChild(next);
        units.push({
          el: wrap, index: idx,
          boundIndexes: [idx, parseInt(next.getAttribute('data-block-index'), 10)],
          forceFull: !!next.getAttribute('data-force-full'),
          fullH: 0, halfH: 0,
        });
        i++;
        continue;
      }
      units.push({
        el: el, index: idx, boundIndexes: [idx],
        forceFull: !!el.getAttribute('data-force-full'),
        fullH: 0, halfH: 0,
      });
    }

    var style = getComputedStyle(pageEl);
    var usable = pageEl.clientHeight - parseFloat(style.paddingBottom) - container.offsetTop;
    var colGapPx = parseFloat(getComputedStyle(container).columnGap) || 0;

    measure(container, units, columns, colGapPx);

    var packed = window.packUnits(units, { columns: columns, pageHeight: usable, rowGap: rowGapPx });

    var spillIndexes = [];
    for (var s = 0; s < packed.spill.length; s++) {
      var su = packed.spill[s];
      spillIndexes = spillIndexes.concat(su.boundIndexes);
      su.el.remove();
    }
    spillIndexes.sort(function (a, b) { return a - b; });

    var used = 0;
    for (var r = 0; r < packed.rows.length; r++) {
      var row = packed.rows[r];
      for (var c = 0; c < row.items.length; c++) {
        var item = row.items[c];
        item.unit.el.classList.add(item.span === 'full' ? 'span-full' : 'span-half');
        item.unit.el.style.gridColumnStart = String(item.col + 1);
        container.appendChild(item.unit.el); // reorder DOM to packed order
      }
      used += row.height + (r ? rowGapPx : 0);
    }

    window.LAYOUT = { spillIndexes: spillIndexes, usedPx: Math.round(used), usablePx: Math.round(usable) };
    document.body.dataset.layoutDone = '1';
  };
})();
```

- [ ] **Step 2: Wire the template and manifest**

In `templates/spiral-notes/manifest.json` add:
```json
  "maxColumns": 2,
  "columnGap": "2.2vw"
```

In `templates/spiral-notes/template.html`, replace the two script tags plus the PAGEVARS block's trailing call with:
```html
<script src="../_shared/rough.min.js"></script>
<script src="../_shared/pack.js"></script>
<script src="../_shared/layout.js"></script>
<script src="../_shared/jitter.js"></script>
<!--PAGEVARS-->
<script>
  document.getElementById('v-brand').textContent = PAGE.brand;
  document.getElementById('v-date').textContent = PAGE.date;
  document.getElementById('v-series').textContent = PAGE.series;
  document.getElementById('v-ptitle').textContent = 'Page ' + PAGE.pageNum + ' : ' + PAGE.page_title;
  applyLayout({ columns: PAGE.columns, rowGapPx: PAGE.rowGapPx });
  applyJitter(PAGE.seed + PAGE.pageNum);
</script>
```
(Layout must run before jitter: jitter rewrites text nodes, which would invalidate measurements.)

In `lib/renderer/page.ts`: import `renderSlideBlocks` instead of `renderBlockHtml`, build content with `renderSlideBlocks(slide.blocks)`, read `maxColumns`/`columnGap` from the manifest (defaults `2` and `'2.2vw'`), add them to the `PAGE` object as `columns` and `rowGapPx: Math.round(height * 0.012)`, and inject a style block setting the CSS vars:
```ts
const head =
  `<link rel="stylesheet" href="../_shared/fonts.css">` +
  `<link rel="stylesheet" href="../_shared/base.css">` +
  `<style>#content{--pk-cols:${columns};--pk-col-gap:${columnGap}}</style>`;
```
Also widen `templateManifest`'s return type with `maxColumns?: number; columnGap?: string`.

- [ ] **Step 3: Verify a real render**

Run: `npx tsx scripts/sample-render.mts spiral-notes ./tmp-grid.png`
Expected: prints `overflow: 0`; open `tmp-grid.png` and confirm content sits in two columns with the table spanning full width. Delete the file afterwards.

- [ ] **Step 4: Commit**

```bash
git add templates/_shared/layout.js templates/spiral-notes lib/renderer/page.ts
git commit -m "feat: in-page grid layout driver measuring blocks at both widths"
```

---

### Task 4: Capture reads spill; renderAll auto-flows

**Files:**
- Modify: `lib/renderer/capture.ts`
- Test: `tests/render.e2e.test.ts`

**Interfaces:**
- Consumes: `window.LAYOUT` and `body[data-layout-done="1"]` (Task 3).
- Produces:
  - `renderSlide(post, slideIndex, outPath) -> Promise<{ overflowPx: number; fillPct: number; spillIndexes: number[] }>`
  - `renderAll(post, outDir) -> Promise<{ results: {slide,overflowPx,fillPct,file}[]; slides: Post['slides'] }>` — `slides` is the post-autoflow slide array (unchanged when nothing spilled).

- [ ] **Step 1: Write the failing test**

Replace the overflow test in `tests/render.e2e.test.ts` and add an auto-flow test:
```ts
it('spills overflowing content instead of overflowing the page', async () => {
  const big = makePost('spiral-notes');
  big.slides[0].blocks = Array.from({ length: 40 }, () => ({
    type: 'paragraph' as const,
    text: 'Long line of handwritten content that keeps going. '.repeat(4),
  }));
  const out = path.join(tmpdir(), `iolar-ovf-${Date.now()}.png`);
  const r = await renderSlide(big, 0, out);
  expect(r.overflowPx).toBe(0);
  expect(r.spillIndexes.length).toBeGreaterThan(0);
}, 90_000);

it('renderAll chains spill onto new slides', async () => {
  const big = makePost('spiral-notes');
  big.slides[0].blocks = Array.from({ length: 40 }, () => ({
    type: 'paragraph' as const,
    text: 'Long line of handwritten content that keeps going. '.repeat(4),
  }));
  const dir = path.join(tmpdir(), `iolar-flow-${Date.now()}`);
  const { results, slides } = await renderAll(big, dir);
  expect(slides.length).toBeGreaterThan(1);
  expect(results.length).toBe(slides.length);
  expect(results.every((r) => r.overflowPx === 0)).toBe(true);
  expect(slides[1].page_title).toContain('(cont.)');
  const totalBlocks = slides.reduce((n, s) => n + s.blocks.length, 0);
  expect(totalBlocks).toBe(40);
}, 240_000);
```
Import `renderAll` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render.e2e.test.ts`
Expected: FAIL — `spillIndexes` undefined; `renderAll` returns an array, not `{results, slides}`.

- [ ] **Step 3: Write the implementation**

In `lib/renderer/capture.ts`, replace the wait + metrics block inside `renderSlide`:
```ts
await page.goto('file://' + tmpFile.replace(/\\/g, '/'));
await page.waitForSelector('body[data-layout-done="1"]', { timeout: 20000 });
await page.waitForSelector('body[data-jitter-done="1"]', { timeout: 20000 });
await page.evaluate(() => document.fonts.ready);

const layout = await page.evaluate(() => window.LAYOUT as { spillIndexes: number[]; usedPx: number; usablePx: number });
const overflowPx = Math.max(0, layout.usedPx - layout.usablePx);
const fillPct = Math.round((layout.usedPx / layout.usablePx) * 100);
```
and return `{ overflowPx, fillPct, spillIndexes: layout.spillIndexes }`. Add above the file's imports:
```ts
declare global {
  interface Window { LAYOUT: { spillIndexes: number[]; usedPx: number; usablePx: number } }
}
```

Replace `renderAll`:
```ts
const MAX_AUTOFLOW_PAGES = 30; // guard against a single unsplittable block looping forever

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{ results: { slide: number; overflowPx: number; fillPct: number; file: string }[]; slides: Post['slides'] }> {
  const slides = post.slides.map((s) => ({ ...s, blocks: [...s.blocks] }));
  const results: { slide: number; overflowPx: number; fillPct: number; file: string }[] = [];

  for (let i = 0; i < slides.length && i < MAX_AUTOFLOW_PAGES; i++) {
    const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides };
    const r = await renderSlide(working, i, file);

    // A page whose every block spilled cannot be split further — keep it and move on.
    if (r.spillIndexes.length && r.spillIndexes.length < slides[i].blocks.length) {
      const spilled = new Set(r.spillIndexes);
      const kept = slides[i].blocks.filter((_, j) => !spilled.has(j));
      const moved = slides[i].blocks.filter((_, j) => spilled.has(j));
      slides[i] = { ...slides[i], blocks: kept };
      const title = slides[i].page_title.replace(/ \(cont\.\)$/, '');
      slides.splice(i + 1, 0, { page_title: `${title} (cont.)`, blocks: moved });
      i--; // re-render this page now that it is trimmed
      continue;
    }
    results.push({ slide: i + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file });
  }

  return { results, slides };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render.e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/capture.ts tests/render.e2e.test.ts
git commit -m "feat: auto-flow spilled blocks onto continuation pages"
```

---

### Task 5: Persist auto-flow; soften the slide cap

**Files:**
- Modify: `app/api/paperbook/[slug]/render/route.ts`
- Modify: `lib/schema.ts`
- Modify: `components/editor/SlideChips.tsx`
- Modify: `app/paperbook/[slug]/page.tsx`
- Test: `tests/api.paperbook.test.ts`, `tests/schema.test.ts`

**Interfaces:**
- Consumes: `renderAll(post, outDir) -> { results, slides }` (Task 4).
- Produces: `POST /api/paperbook/:slug/render` response gains `slides: number` (final count) and `split: boolean`; when `split` is true the route has already saved the new slide array via `savePost` (which re-indexes SQLite and the graph).

- [ ] **Step 1: Write the failing tests**

In `tests/schema.test.ts`, replace the max-slides test:
```ts
it('accepts more than 10 slides (cap is advisory)', () => {
  const many = structuredClone(minimal);
  many.slides = Array.from({ length: 12 }, (_, i) => ({
    page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
  }));
  expect(validatePost(many).slides.length).toBe(12);
});
```

In `tests/api.paperbook.test.ts`, replace the 11-slide rejection test:
```ts
it('accepts a put with 11 slides and reports the count', async () => {
  const list = await import('@/app/api/paperbook/route');
  const item = await import('@/app/api/paperbook/[slug]/route');
  const created = await (await list.POST(req('POST', { slug: 'cap' }))).json();
  created.slides = Array.from({ length: 11 }, (_, i) => ({
    page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
  }));
  const res = await item.PUT(req('PUT', created), params('cap'));
  expect(res.status).toBe(200);
  expect((await res.json()).slides.length).toBe(11);
});

it('render reports the final slide count after auto-flow', async () => {
  const list = await import('@/app/api/paperbook/route');
  const render = await import('@/app/api/paperbook/[slug]/render/route');
  await (await list.POST(req('POST', { slug: 'flow' }))).json();
  const res = await render.POST(req('POST', {}), params('flow'));
  const body = await res.json();
  expect(typeof body.slides).toBe('number');
  expect(typeof body.split).toBe('boolean');
}, 120_000);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/schema.test.ts tests/api.paperbook.test.ts`
Expected: FAIL — schema still rejects 11 slides; render response has no `slides`/`split`.

- [ ] **Step 3: Write the implementation**

`lib/schema.ts` — drop the `.max()` and keep the constant advisory:
```ts
/** Instagram shows 10 carousel images. Advisory: the UI warns past this, nothing rejects it. */
export const MAX_SLIDES = 10;
```
```ts
  slides: z
    .array(z.object({ page_title: z.string(), blocks: z.array(BlockSchema).min(1) }))
    .min(1),
```

`app/api/paperbook/[slug]/render/route.ts` — in the render-all branch:
```ts
    } else {
      const out = await renderAll(post, outDir);
      results = out.results;
      if (out.slides.length !== post.slides.length) {
        await savePost(slug, { ...post, slides: out.slides });
        split = true;
      }
    }
```
Declare `let split = false;` above, import `savePost`, and return:
```ts
    return NextResponse.json({ results, slides: results.length, split });
```

`components/editor/SlideChips.tsx` — warn instead of block:
```tsx
      <Tooltip title={count >= MAX_SLIDES ? `${count} slides — over Instagram's ${MAX_SLIDES}-image limit` : 'add slide'}>
        <Button onClick={onAdd} aria-label="add slide" style={{ borderStyle: 'dashed' }}>
          +
        </Button>
      </Tooltip>
```

`app/paperbook/[slug]/page.tsx` — show the warning and reload after a split. Next to the saved/unsaved tag:
```tsx
        {post.slides.length > MAX_SLIDES && (
          <Tag color="warning">{post.slides.length} slides — over Instagram&apos;s {MAX_SLIDES}</Tag>
        )}
```
and inside `render`, after reading `body`:
```ts
      if (body.split) {
        const fresh = await fetch(`/api/paperbook/${slug}`).then((r) => r.json());
        setPost(fresh);
        message.info(`Content reflowed onto ${body.slides} pages`);
      }
```
Import `MAX_SLIDES` from `@/lib/schema` in both files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/schema.test.ts tests/api.paperbook.test.ts tests/editor.test.tsx`
Expected: PASS. (The editor test asserting the add button is disabled at 10 must be updated to assert it is enabled and the tooltip warns — change `expect(...disabled).toBe(true)` to `toBe(false)`.)

- [ ] **Step 5: Commit**

```bash
git add lib/schema.ts app/api/paperbook/[slug]/render/route.ts components/editor/SlideChips.tsx app/paperbook/[slug]/page.tsx tests
git commit -m "feat: persist auto-flow splits and make the 10-slide cap advisory"
```

---

### Task 6: AI heading pass for split pages

**Files:**
- Create: `lib/ai/headings.ts`
- Modify: `app/api/paperbook/[slug]/plan/route.ts`
- Modify: `app/paperbook/[slug]/page.tsx`
- Test: `tests/headings.test.ts`

**Interfaces:**
- Consumes: `runClaude` from `@/lib/ai/claude`, `extractJson` from `@/lib/ai/revise`, `loadPost` from `@/lib/store`.
- Produces: `fixHeadings(slug: string): Promise<Post>` — returns a proposal with rewritten `page_title`s and does **not** save. Reached via `POST /api/paperbook/:slug/plan` with `{ mode: 'headings' }`, which responds `{ proposal }`.

- [ ] **Step 1: Write the failing test**

`tests/headings.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, Post } from '@/lib/schema';

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [
    { page_title: 'Lists', blocks: [{ type: 'heading', text: 'A' }] },
    { page_title: 'Lists (cont.)', blocks: [{ type: 'heading', text: 'B' }] },
  ],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-head-'));
  vi.resetModules();
});

describe('fixHeadings', () => {
  it('returns a proposal with rewritten titles and leaves disk untouched', async () => {
    const proposal = base();
    proposal.slides[1].page_title = 'Lists — Methods';
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createPost, loadPost } = await import('@/lib/store');
    await createPost('head', base());
    const { fixHeadings } = await import('@/lib/ai/headings');
    const out = await fixHeadings('head');

    expect(out.slides[1].page_title).toBe('Lists — Methods');
    expect((await loadPost('head')).slides[1].page_title).toBe('Lists (cont.)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/headings.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/headings`.

- [ ] **Step 3: Write the implementation**

`lib/ai/headings.ts`:
```ts
import { Post, validatePost } from '../schema';
import { loadPost } from '../store';
import { runClaude } from './claude';
import { extractJson } from './revise';

/**
 * After auto-flow splits a page, continuation pages carry a "(cont.)" placeholder title.
 * This rewrites the affected titles so the sequence reads like a designed handbook.
 * Returns a proposal; saving is the caller's decision.
 */
export async function fixHeadings(slug: string): Promise<Post> {
  const post = await loadPost(slug);
  const titles = post.slides.map((s, i) => `${i + 1}. ${s.page_title}`).join('\n');
  const prompt = [
    'A handwritten-notes carousel was reflowed, so some pages were split and carry "(cont.)" placeholder titles.',
    'Rewrite ONLY the page_title of each slide so the sequence reads as a deliberate handbook: a split pair becomes two distinct, specific titles describing what is actually on each page (for example "Python Lists" and "List Methods & Slicing"), never "(cont.)".',
    'Change nothing else — every block must stay byte-identical, and the slide count must not change.',
    'Current titles:',
    titles,
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].join('\n\n');

  const out = await runClaude(prompt, { timeoutMs: 300_000 });
  const proposal = validatePost(extractJson(out));
  if (proposal.slides.length !== post.slides.length) {
    throw new Error('heading pass changed the slide count — rejected');
  }
  return proposal;
}
```

In `app/api/paperbook/[slug]/plan/route.ts`, above the densify branch:
```ts
    if (body.mode === 'headings') {
      const { fixHeadings } = await import('@/lib/ai/headings');
      return NextResponse.json({ proposal: await fixHeadings(slug) });
    }
```

In `app/paperbook/[slug]/page.tsx`, after a split is detected in `render`:
```ts
        const h = await fetch(`/api/paperbook/${slug}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'headings' }),
        });
        if (h.ok) {
          const { proposal } = await h.json();
          setPost(proposal);
          await save(proposal);
          message.success('Page titles updated for the new pages');
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/headings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/headings.ts app/api/paperbook/[slug]/plan/route.ts app/paperbook/[slug]/page.tsx tests/headings.test.ts
git commit -m "feat: AI heading pass for auto-flow continuation pages"
```

---

### Task 7: Roll the grid out to the remaining seven templates

**Files:**
- Modify: `templates/margin-qa/*`, `templates/blackboard/*`, `templates/studygram-pastel/*`, `templates/engineer-grid/*`, `templates/terminal-dark/*`, `templates/legal-pad/*`, `templates/sticky-wall/*`
- Test: `tests/render.e2e.test.ts`, `tests/templates.test.ts`

**Interfaces:**
- Consumes: `window.applyLayout({ columns, rowGapPx })` and the manifest keys from Task 3.
- Produces: every template loads `pack.js` + `layout.js`, calls `applyLayout` before `applyJitter`, and declares `maxColumns` (2 everywhere; **3** for `sticky-wall`) and `columnGap` in its manifest.

- [ ] **Step 1: Extend the contract test**

In `tests/templates.test.ts`, inside the per-template assertions:
```ts
    expect(html).toContain('_shared/pack.js');
    expect(html).toContain('_shared/layout.js');
    expect(html.indexOf('applyLayout')).toBeLessThan(html.indexOf('applyJitter('));
    expect(typeof m.maxColumns).toBe('number');
    expect(typeof m.columnGap).toBe('string');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/templates.test.ts`
Expected: FAIL for the seven templates not yet updated.

- [ ] **Step 3: Update each template**

For each of the seven: add the two script tags before `jitter.js`, add `applyLayout({ columns: PAGE.columns, rowGapPx: PAGE.rowGapPx });` immediately before the `applyJitter(...)` call, and add `"maxColumns"` / `"columnGap"` to its manifest (`sticky-wall`: `3`; everyone else: `2`; gap `"2.2vw"`, `sticky-wall` `"1.8vw"`).

`sticky-wall` additionally drops its own `columns: 2` rule from `#content` — the grid now owns that:
```css
#content{column-gap:1.8vw}
```

- [ ] **Step 4: Run the full render suite**

Run: `npx vitest run tests/templates.test.ts tests/render.e2e.test.ts`
Expected: PASS for all eight templates.

- [ ] **Step 5: Eyeball each template**

Run for each name: `npx tsx scripts/sample-render.mts <template> ./tmp-<template>.png`, open the PNGs, confirm two columns (three for sticky-wall) and full-width tables. Delete the temp files.

- [ ] **Step 6: Commit**

```bash
git add templates tests/templates.test.ts
git commit -m "feat: grid layout across all eight templates"
```

---

### Task 8: Density assertions, goldens, docs

**Files:**
- Modify: `tests/render.e2e.test.ts`, `tests/golden/*.png`, `README.md`
- Modify: `lib/ai/plan.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the locked golden set for the grid layout, plus planner guidance matching the new capacity.

- [ ] **Step 1: Add the density test**

In `tests/render.e2e.test.ts`:
```ts
it.each(['spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel', 'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall'])(
  '%s fills a dense page without overflowing',
  async (template) => {
    const dense = makePost(template);
    dense.slides[0].blocks = [
      { type: 'heading', text: '1. Overview' },
      { type: 'paragraph', text: 'A dense page exercising the packer with mixed block widths and heights.' },
      { type: 'bullets', items: ['first point', 'second point', 'third point', 'fourth point'] },
      { type: 'heading', text: '2. Comparison' },
      { type: 'table', headers: ['Type', 'Ordered', 'Mutable', 'Use'], rows: [['list', 'yes', 'yes', 'sequence'], ['tuple', 'yes', 'no', 'fixed'], ['set', 'no', 'yes', 'unique']] },
      { type: 'heading', text: '3. Example' },
      { type: 'code', lang: 'python', lines: ['xs = [1, 2, 3]', 'xs.append(4)', 'print(xs)'] },
      { type: 'sidebox', title: 'Remember', items: ['sets drop duplicates', 'tuples hash'], ink: 'green' },
      { type: 'callout', style: 'tip', title: 'Interview Tip', text: 'Name the complexity before you pick the container.' },
    ];
    const out = path.join(tmpdir(), `iolar-dense-${template}-${Date.now()}.png`);
    const r = await renderSlide(dense, 0, out);
    expect(r.overflowPx).toBe(0);
    expect(r.spillIndexes).toEqual([]);
    expect(r.fillPct).toBeGreaterThan(55);
  },
  120_000
);
```

- [ ] **Step 2: Regenerate and inspect the goldens**

Run: `node scripts/approve-goldens.mjs`
Open every file in `tests/golden/` and confirm the two-column layout looks right before locking it in.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: all files pass, including the byte-identical determinism test and the golden comparison.

- [ ] **Step 4: Update the planner budget and README**

In `lib/ai/plan.ts`, replace the FILL THE PAGE paragraph of `SCHEMA_RULES` with:
```
FILL THE PAGE. Each slide is a full handwritten notebook page laid out as a TWO-COLUMN grid, so it holds roughly 95-110 rendered lines — about twice a single column. Count: heading = 1 line, each bullet = 1 line, each table row = 1 line (plus 1 for headers), each code line = 1 line, paragraph = 1 line per 85 characters, callout/sidebox = 2 lines plus its items. Wide tables (4+ columns) and diagrams span the full width; everything else is packed two-up automatically, so short blocks pair off. That is normally 12-16 blocks per slide with 4-6 numbered sections. Overflowing is safe — the renderer reflows the excess onto a new page — but a half-empty page is wasted space, so aim high.
```

In `README.md`, under the pipeline section, add:
```
Pages are laid out as a packed two-column grid: blocks are measured at both
widths in the browser, wide tables and diagrams span the page, short blocks
pair off, and anything that does not fit reflows onto a continuation page
(the slide array is written back to post.json and the titles get an AI pass).
```

- [ ] **Step 5: Commit**

```bash
git add tests README.md lib/ai/plan.ts
git commit -m "test: grid density assertions and regenerated goldens; docs: grid layout"
```

---

## Self-Review (done at write time)

- **Spec coverage:** §2 layout model → Tasks 1-3, 7; §3 packing pass → Tasks 1, 3; §4 auto-flow and sync → Tasks 4, 5; §4 slide cap → Task 5; §4 AI heading pass → Task 6; §5 components → all tasks (each file in the spec's table has an owning task); §6 testing → Tasks 1, 4, 7, 8.
- **Placeholder scan:** no TBD/TODO; every code step carries real code; the seven-template rollout in Task 7 spells out the exact edits and values rather than saying "same as Task 3".
- **Type consistency:** `packUnits(units, opts) -> {rows, spill}`, `applyLayout({columns, rowGapPx})`, `window.LAYOUT.{spillIndexes,usedPx,usablePx}`, `renderSlide -> {overflowPx, fillPct, spillIndexes}`, `renderAll -> {results, slides}`, `fixHeadings(slug) -> Post` are used identically everywhere they appear.
- **Known follow-on:** the existing editor test asserting the add-slide button is disabled at 10 is explicitly updated in Task 5 Step 4.
