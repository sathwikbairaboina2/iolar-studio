# Handbook Blocks — Design

Date: 2026-09-06. Branch: `feat/handbook-blocks`. Status: approved in chat, pending spec review.

## 1. Problem

The reference carousel "Binary Search Patterns" (7 pages, `@abhi_techhub`) was compared
against the studio's own renders (`data/handbooks/security/injection`, spiral-notes, fill
83-98%). Density and two-column packing are already close. What is missing is the
vocabulary of a handwritten study sheet:

1. No inline emphasis. The reference highlights key terms in yellow marker, colours words
   red (`RIGHT`, `LEFT`), underlines answers. Every block string is HTML-escaped wholesale
   in `lib/renderer/blocks.ts`, so no inline markup can survive.
2. Code renders in JetBrains Mono, one colour, and wraps mid-line inside a half column
   (slide 1: `WHERE` / `name='` split, comments misaligned). The reference has handwriting
   code, syntax colours, never wraps, and a sticky note pinned beside the box.
3. Only `diagram.kind: 'flow'` renders. `memory-cells`, `tree`, `compare` exist in the enum
   but fall through to a grey placeholder; the planner never emits them (83 rendered
   diagrams, all `flow`). The reference needs array cells with index row and pointer
   arrows, a vertical flowchart with a decision diamond, coloured step pipelines, a small
   matrix, and a summary strip of mini cards.
4. Bullets and paragraphs float bare. The reference boxes almost every section body in a
   colour-coded dashed or solid rough frame.
5. One bullet glyph. The reference uses circled numbers for procedures, ✓ for
   prerequisites, ✗ for mistakes.
6. No sticky note object. `callout.tip` is a red box with an emoji.
7. Tables: 2 px dark borders, no header tint, no highlighted answer row.
8. Page chrome: the series dominates and the page title is small. The reference makes the
   numbered page title the dominant element, gives the page number its own badge, puts
   the handle top left, and has no date.
9. Section headers: ☆ marker, purple small caps.
10. The planner does not know the algorithm-page recipe (definition, template code,
    condition table, dry run, walkthrough, mistakes) nor the closing revision sheet.

## 2. Decisions

- **Blocks are shared, chrome is a family.** Items 1-7 render from `lib/renderer/blocks.ts`
  with default styling in `templates/_shared/base.css` using each family's ink variables,
  so all eight existing families get them. Items 8-9 are a page frame and go into a new
  ninth family, `study-sheet`.
- **Planner-first.** New fields and kinds are produced by the planner and rendered. The
  editor gets no new form controls in this pass; it must not lose or corrupt the new
  fields.
- **Inline markup is text, not structure.** Markdown-like markers inside strings, parsed
  at render time. A structured `{spans:[…]}` shape was rejected: model-hostile and it
  triples JSON size.
- **Typed diagram specs.** `spec` becomes a per-kind zod object. `memory-cells`, `tree`
  and `compare` are removed from the enum; no stored post uses them.

## 3. Inline markup

Applies to: `paragraph.text`, `bullets.items`, `sidebox.items` and `title`, `callout.title`
and `text`, `table` cells and headers, `qa.q` and `a_bullets`, diagram labels, `code.note`.
Not applied to: `heading.text`, `page_title`, `code.lines`.

| marker | render |
|---|---|
| `==term==` | `<mark class="hl">` yellow marker swipe |
| `**word**` | `<span class="em">` red emphasis, bold |
| `__word__` | `<span class="ul">` underline |
| `` `x` `` | `<code class="mono">` monospace inline |
| `{green:word}` `{blue:…}` `{red:…}` `{purple:…}` `{orange:…}` `{black:…}` | `<span class="ink-green">` etc. |

`lib/renderer/inline.ts`:

- `renderInline(s: string): string` — escapes HTML first, then replaces markers with spans.
  Markers may not nest across each other; an unmatched marker stays literal. `{ink:…}`
  accepts only the six ink names listed above (`accent` is not exposed inline), anything else stays literal.
- `stripInline(s: string): string` — removes markers, keeps the inner text. Used by
  `lib/ai/fit.ts` `postText()` (so `__mid__` cannot break keyword coverage) and by
  `components/editor/DiffCard.tsx` `blockText()`.

`data-jitter` walks text nodes and wraps characters in spans; the parent's
`text-decoration` is already copied onto each character span, so `__underline__` survives
jitter. `<mark>` background must be on the mark element, not per character, so the
jitter walker skips descending into `.hl` and treats it as one atomic word (whitespace
allowed inside).

## 4. Block schema additions (`lib/schema.ts`)

All new fields are optional; every stored post validates unchanged.

```
Ink = 'blue'|'red'|'green'|'black'|'accent'|'purple'|'orange'
Frame = 'none'|'solid'|'dashed'

bullets  { items, style?: 'dot'|'number'|'check'|'cross', frame?, ink? }
paragraph{ text, frame?, ink? }
table    { headers, rows, highlightRow?: int >= 0, frame? }
code     { lang, lines, note?: string }
callout  { style: 'tip'|'takeaway'|'cloud'|'sticky'|'sticky-pink', title, text }
diagram  { kind, spec }  — spec typed per kind, see §6
```

Rendering of the new fields:

- `bullets.style`: `number` renders ①②③ (U+2460…, falls back to `1.` past ⑳); `check` ✓ in
  green; `cross` ✗ in red; `dot` unchanged.
- `frame`: wraps the block body in a `div.b-frame` (manifest `defaults.frame` applies to bullets and paragraph only; a table draws its own rules and takes a frame only when set explicitly) with `data-rough` (ink) and
  `data-rough-dash="1"` for dashed. `jitter.js` passes `strokeLineDash: [9, 7]` to
  rough.js when the attribute is present. Frames count as part of the unit height, so the
  packer measures them.
- `table.highlightRow`: that `<tr>` gets `class="hl-row"` (yellow tint). Header cells get
  `background: var(--table-head, transparent)`; borders become 1.5 px `var(--rule, #777)`.
  Families set `--table-head` and `--rule` in `:root`; unset means today's look.
- `callout.sticky` / `sticky-pink`: `div.b-callout.co-sticky` with a pin glyph, paper
  shadow, seeded rotation of ±2° (from `applyJitter`'s RNG), no rough frame. `sticky-pink`
  swaps the paper colour.
- `code.note`: `div.code-note` absolutely positioned top right inside `.b-code`, same
  sticky styling, narrower. The code box reserves right padding equal to the note width so
  lines never run under it.

### Template manifest additions

```
inks:      must declare all seven inks (base.css provides fallbacks: purple → blue, orange → red)
defaults?: { frame?: Frame }          applied by the renderer when the block leaves frame unset
codeFont?: 'mono' | 'hand'            default 'mono'
```

`templateManifest()` in `lib/renderer/page.ts` returns the new fields; `renderSlideBlocks`
takes the manifest defaults as a parameter. `codeFont: 'hand'` adds `class="code-hand"` on
`#page` so the template's CSS can switch the family.

## 5. Code block

- Syntax colouring: `lib/renderer/syntax.ts` `tokenize(lang, line): Token[]` for four
  language families — c-like (`java`, `js`, `ts`, `c`, `cpp`, `go`, `rust`, `kotlin`,
  `swift`, `csharp`), `python`, `sql`, `shell` (`bash`, `sh`, `powershell`). Unknown
  languages get comments and strings only. Token classes: `tk-kw`, `tk-cm`, `tk-str`,
  `tk-num`, `tk-fn` (identifier followed by `(`). Colours come from the family's inks:
  keywords `--ink-purple`, comments `--ink-green`, strings `--ink-red`, numbers
  `--ink-orange`, functions `--ink-blue`. Line-by-line, no multi-line state; a block
  comment opener colours to end of line only.
- Never wraps: `.b-code { white-space: pre; overflow: hidden }`. `forcesFullWidth()` returns
  true when the longest line exceeds 34 characters (20 when the block carries a `note`, since the note takes the right quarter of the box). Longest line over 60 characters adds
  `class="code-small"` (one font step down, ~85%). Over 80 characters the line is
  truncated with `…` at 80 and the render report gains a `warnings` entry naming the block.
- Handwriting mode (`codeFont: 'hand'`): `#page.code-hand .b-code` uses `'Patrick Hand'`
  with `letter-spacing: .02em` and `tab-size: 4`; indentation is preserved because
  `white-space: pre` keeps leading spaces and the font is proportional but leading spaces
  still stack. Jitter stays off for code in both modes.

## 6. Diagrams

`diagram.kind ∈ 'flow' | 'array' | 'flowchart' | 'matrix' | 'cards'`. Each kind has a zod
spec; a wrong spec fails `validatePost`, and the planner's retry sees the zod error.

### flow (existing, extended)

```
{ nodes: (string | { text, sub?, ink? })[] }
```
Object nodes render a two-line coloured box (title, small subtitle) with a rough frame in
`ink`. Half width allowed up to 3 nodes; 4 or more forces full width. Arrows stay `→`.

### array

```
{ cells: string[], indices?: boolean (default true),
  pointers?: { index: int, label: string, ink? }[],
  highlight?: int[], dim?: int[], caption?: string }
```
Rendered as HTML: an index row (small, `--ink-blue`), a row of rough-framed cells
(`highlight` → yellow fill, `dim` → grey text and lighter frame), a pointer row with `↑`
and the label under the pointed cell (two pointers on one index stack vertically), and an
optional caption to the right in a rough box. Always full width. Cells over 12 make the
cells narrower rather than wrapping; over 20 is a zod error.

### flowchart

```
{ rows: string[][],                        // node ids, top to bottom; 1-3 ids per row
  nodes: Record<id, { text, shape?: 'box'|'diamond'|'pill', ink? }>,
  edges: { from, to, label? }[] }
```
The planner supplies the grid. The renderer lays each row's nodes evenly across the width
and draws nodes as HTML (rough frames; diamond via a rotated square wrapper) and edges as
one SVG overlay with orthogonal polylines and arrowheads: vertical when `from` is directly
above `to`, elbow (down, across, down) otherwise. Labels sit at the elbow or at the
midpoint of a straight edge, in `--ink-green` for `yes`/`true` and `--ink-red` for
`no`/`false`, `--ink-black` otherwise. Edge geometry is computed after layout from element
rects, inside `applyLayout`'s post-pass, before `applyJitter`. Always full width. Limits:
2-7 rows, up to 12 nodes.

### matrix

```
{ rows: string[][], highlight?: [row, col][], caption?: string }
```
Rough-framed grid of equal cells, highlighted cells yellow, caption to the right. Half
width allowed up to 4 columns.

### cards

```
{ cards: { title, lines: string[], ink? }[] }   // 2-4 cards
```
One full-width row of equal rough-framed mini boxes, title underlined in the card's ink,
lines as compact bullets. The summary strip.

`forcesFullWidth()` summary: `array`, `flowchart`, `cards` always; `flow` with ≥4 nodes;
`matrix` with >4 columns; `table` with ≥4 headers (unchanged); `code` with a line >34
characters.

## 7. `study-sheet` family

`templates/study-sheet/template.html` + `manifest.json`, cloned from the reference chrome:

- Header row: `@brand` top left in Patrick Hand with a double blue underline; series
  centred in a green rough rounded badge (`data-rough`, Architects Daughter caps); `Page N`
  top right in a red rough badge. No date.
- Title: `N. TITLE` (N = pageNum) in Architects Daughter caps, ~3.6vh, black, with a red
  hand-drawn underline (rough.js line, not CSS).
- Headings: `☆ ` prefix via `::before`, Architects Daughter caps in `--ink-purple`,
  ~2.1vh, no underline.
- Body: Patrick Hand ~1.55vh. Tables: `--table-head: #e8f3e8`, `--rule: #8a8a8a`.
- Manifest: `defaults: { frame: 'dashed' }`, `codeFont: 'hand'`, `maxColumns: 2`, inks
  purple `#5b3fa0`, blue `#2b4ea8`, red `#c62828`, green `#2e7d32`, orange `#d97706`,
  black `#222`, accent `#c62828`.
- Paper: plain off-white, no rules, lighter vignette.

`TEMPLATES` in `lib/schema.ts`, `SCHEMA_RULES`, `tests/templates.test.ts` and the render
e2e list gain `study-sheet`.

## 8. Planner (`lib/ai/plan.ts` `SCHEMA_RULES`)

Documents every new field, kind and marker with one-line usage rules:

- Highlight 1-3 key terms per block with `==…==`; colour a decisive word with `**…**`.
- `style: "number"` for procedures and algorithms; `"check"` for prerequisites and
  "when to use"; `"cross"` for mistakes and anti-patterns.
- `code.note` for the one gotcha next to a snippet, ≤ 8 words.
- `array` wherever indices or pointers are walked; `flowchart` for any decision procedure;
  `cards` for an end-of-page summary; `matrix` for 2-D data.
- Dry-run tables: `Step | low | high | mid | arr[mid] | action` shape, `highlightRow` on the
  answer row.
- Code lines ≤ 34 characters so a snippet can sit in a column; a longer line forces the
  block wide.

Recipe guidance for algorithm-shaped subjects (the model decides whether the subject is
one): each pattern page carries definition, template code, condition/action table, dry run,
visual walkthrough, mistakes; the last page is a revision sheet with a most-asked list, a
decision flowchart, a quick-reference table and a complexity table. Guidance only; the fit
gate and coverage rules are unchanged.

`densifySlides`, `fitToPages` and `revise` share `SCHEMA_RULES` and inherit this. The
`BookSchema.layout` type enum in `lib/ai/book.ts` is unchanged (block types only).

## 9. Compatibility

- Editor: `BlockForm` patches merge into the block, so unknown fields survive edits. The
  diagram form's JSON textarea edits any spec; `DIAGRAM_OPTS` lists the five kinds.
  `DiffCard.blockText` strips inline markers.
- Knowledge index and coverage (`lib/handbookIndex.ts`, `lib/knowledge/spaces/handbooks.ts`)
  read `heading.text` only, which carries no markup.
- Existing posts: re-render identically except code no longer wraps (it now forces full
  width or steps down). `render-report.json` gains an optional `warnings: string[]` per
  slide; `packageExport` ignores warnings.
- Jitter RNG order: sticky rotation draws from the same seeded stream, after character
  jitter and before rough frames, so existing renders keep their exact pixels when no
  sticky is present.

## 10. Testing

Unit (vitest, `tests/`):
- `inline.test.ts`: every marker, nesting refused, unmatched literal, bad ink literal,
  `stripInline` round trip, HTML escaping before markers.
- `syntax.test.ts`: keywords/comments/strings/numbers/functions for each family; unknown
  language.
- `blocks.test.ts` additions: list styles, frame wrapper and dash attribute, sticky callout,
  code note, code force-full at 35 chars, `code-small` at 61, truncation at 81 with warning,
  each diagram kind's HTML skeleton, `forcesFullWidth` table, manifest defaults applied.
- `schema.test.ts` additions: new fields accepted, old posts unchanged, each diagram spec
  accepted and a wrong one rejected, `memory-cells` rejected.
- `templates.test.ts`: nine families, all seven inks declared, `study-sheet` markers.
- `fit.test.ts`: coverage ignores markers.
- `plan` prompt test: `SCHEMA_RULES` names every kind, style and marker.

Render e2e (`render.e2e.test.ts`):
- One slide with every new block (all five diagram kinds, framed bullets of each style,
  sticky callout, code with note and a 40-char line) on `study-sheet` and on
  `spiral-notes`: overflow 0, PNG 1080×1440.
- A contact sheet of that slide across all nine families is written to
  `tmpdir()/iolar-blocks-contact.png` for eyeballing.
- `flowchart` edge overlay: the SVG exists and has one `path` per edge.

## 11. Out of scope

- Editor form controls for the new fields (next pass, once the look is proven).
- Mountain/line sketches, trees, general graph layout.
- Per-family overrides of the new block styles beyond ink variables (families may add
  them later).
- Re-rendering the 51 stored parts.

## 12. Decisions log

- Design from set 1 now; reference sets 2 and 3 become follow-ups (user chose A over
  waiting).
- Planner-first, no editor forms (user chose A).
- Shared blocks across all families plus one new family for the chrome (user asked "can we
  do it on all styles").
- `flow` extended instead of adding a `steps` kind: same object, more fields.
- Flowchart grid is authored by the planner, not laid out by the renderer.
