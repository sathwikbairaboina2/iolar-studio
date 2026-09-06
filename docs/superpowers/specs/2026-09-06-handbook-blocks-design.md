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
| `==term==` | `<mark class="hl">` yellow marker swipe (styled as `mark.hl`; studygram-pastel already owns a `.hl` span for its series swipe) |
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

## 13. Addendum (6 Sep, after the first end-to-end run): column-flow packing

The first planned handbook rendered at 83-94% "fill" yet wasted a third of every page: row
packing pairs a short block with a tall one and leaves the difference empty, diagrams were
forced full width and centred, and a code note reserved a quarter of the box. Changes:

- `templates/_shared/pack.js` is now **column flow**: each half-width unit drops into the
  shorter column, a full-width unit closes both columns. When a unit no longer fits, the packer
  looks up to six units ahead for one that does; everything never placed spills in original
  order. Result shape: `{ placed: [{unit, span, col, y, height}], spill, usedPx, shortestPx }`.
- `templates/_shared/layout.js` positions every unit absolutely from the measured heights
  (the container becomes a relative box of `usedPx` height) instead of CSS grid rows. Reading
  order is left column down, then right, as in the reference.
- `flowchart` is never forced full width; `array` only past 10 cells. The code note is a chip
  under the last line, so a short snippet keeps its column.
- A first heading that repeats the page title renders as a hidden unit (`pk-hidden`) so the
  block indexes still line up with the post.
- study-sheet: tighter line-height (1.5), smaller frame padding and heading margins, titles
  step down in size instead of wrapping.

Measured on `algorithms/binary-search-patterns` (same post, re-rendered): 10+2 slides at
83-94% became 7+1 slides at 97-100% (last page of each part excepted).

## 14. Addendum: reference sets 2 and 3

Set 2, "AWS Complete Notes" (16 pages, cover + one service family per page), and set 3, "DBMS
Notes Part 1" (10 pages, tables and schemas), same author as set 1. Everything from sets 1 and
the column-flow addendum applies. The user's one hard requirement: **logos stay as real as
possible** — the actual AWS cloud mark and official service icons, the Docker whale, the
Kubernetes helm, the Instagram glyph, not generic stand-ins.

### 14.1 Icons and logos (`lib/renderer/icons.ts`)

Three sources, most real first:

| prefix | package | what | colour |
|---|---|---|---|
| `aws:` | `aws-icons` (official AWS Architecture Icons) | `architecture-service/<Name>.svg` coloured squares; `aws:res:<Name>` for `resource/` line glyphs; `aws` itself = `architecture-group/AWSCloud.svg` | as shipped |
| `brand:` | `simple-icons` | brand marks by slug (`docker`, `kubernetes`, `mongodb`, `redis`, `mysql`, `postgresql`, `instagram`, `linux`, `netapp`, `python`, `github`, …) | brand hex from the package |
| `ui:` | `lucide-static` | generic line icons (`user`, `users`, `lock`, `key`, `phone`, `bell`, `globe`, `file-text`, `folder`, `cpu`, `server`, `database`, `cloud`, …) | `currentColor`, stroke 2 |

`iconSvg(name): string` returns an inline `<svg class="ic ic-aws|ic-brand|ic-ui">` or `''` for an
unknown name (never throws, never breaks a render). A bare name resolves through a curated
alias map first (`ec2`, `s3`, `rds`, `lambda`, `vpc`, `iam`, `cloudwatch`, `route53`,
`cloudfront`, `elb`, `eks`, `ecs`, `ecr`, `ebs`, `efs`, `fsx`, `glacier`, `kms`, `waf`,
`guardduty`, `cloudtrail`, `config`, `ssm`, `cloudformation`, `trustedadvisor`, `eventbridge`,
`organizations`, `redshift`, `elasticache`, `documentdb`, `lightsail`, `batch`, `aurora`,
`directconnect`, `transitgateway`, `vpn`, `storagegateway`, `sns`, `sqs`, `kinesis`,
`apigateway`, `cognito`, `stepfunctions`, `dynamodb`, `autoscaling`, `aws`, `docker`,
`kubernetes`, `mongodb`, `redis`, `mysql`, `postgresql`, `instagram`, `linux`, `netapp`,
`windows`→`ui:monitor`, `oracle`→`ui:database`, plus the generic names), then `aws:` service
CamelCase, then `brand:` slug, then `ui:` slug. `ICON_VOCAB` (the alias names) is exported for
the planner prompt. SVGs are read once and cached.

Where icons appear: the inline marker `{icon:name}` in any text field (so list items and table
cells carry them); `cards[].icon`; flowchart node `icon` and the icon-only node shape; the
slide `hero`; cover `icons[]`. `renderInline` takes an optional `icon` resolver so the module
stays free of `fs` for the client bundle; `stripInline` drops the marker.

### 14.2 Primitives

- Ink `pink` (`#d6338a`, base fallback → red). All manifests declare it.
- `bullets.style` adds `checkbox` (☑) and `star` (☆).
- `callout.cloud` is drawn as a rough scalloped cloud (`data-rough-shape="cloud"`), not a pill.

### 14.3 Diagrams

- `chain`: `{ title?, steps: [{ text, note?, ink? }] }` — vertical boxes joined by ↓ arrows, the
  note beside each step. Half width allowed. (Key hierarchy, three levels, tier architectures.)
- `tables`: `{ tables: [{ title?, headers, rows, caption? }], arrow?: boolean }` — 2-3 small
  tables in one row, `→` between them when `arrow`. Full width when more than two tables or
  more than six columns in total. (Decompositions, before/after normal forms.)
- `schema`: `{ tables: [{ name, columns: string[] }], links: [{ from, to, fromLabel?, toLabel?, arrow? }] }` —
  table boxes (name header, one column per line, `(PK)`/`(FK)` kept as text) in a row, links as
  SVG lines from the right edge of `from` to the left edge of `to`, labels at the ends. Full
  width past two tables.
- `er`: `{ entities: [{ name, attrs: string[], key? }], relations: [{ from, to, name, labels?: [string, string] }] }` —
  entities in a row, a relationship diamond between linked entities, attributes as ovals
  fanned above and below each entity, lines drawn in the browser like flowchart edges.
  Always full width.
- `flowchart` gains `title?`, node `icon?`, node shape `icon` (icon with caption, no box),
  horizontal arrows between nodes that share a row, and side-routed upward edges (a back-edge
  runs down the left margin of the chart).
- `cards` gains `icon?`, `code?: string[]`, `chain?: string[]` (mini vertical chain with ↕),
  `text?`, up to 6 per row; `lines` may be empty when another body field is given.

### 14.4 Slide-level fields

- `hero?: string` — an icon drawn top right of the page chrome (the AWS cloud, a bucket).
- `subtitle?: string` — rendered smaller after the title (`(Identity and Access Management)`).
- `kind?: 'page' | 'cover'` with `cover?: { title, subtitle?, tagline?, icons?: [{ icon, label, sub? }], pills?: string[] }`;
  a cover slide may have no blocks. `page.ts` renders the cover into `#content` with `.cover-*`
  classes and adds `cover` to `#page`; families style it, base.css gives a plain default.

### 14.5 Families

- `sketchnote` (set 2): ruled spiral paper, Instagram-glyph handle badge top left, `PAGE N`
  cloud badge top right, purple numbered title with subtitle, intro line, hero icon, purple
  uppercase section headings, coloured icon cards, dashed diagram boxes.
- `marker-notes` (set 3): handle box top left, `••— SERIES —••` centre with the part line under
  it, `Page 0N` box top right, page title with a yellow marker swipe, green/navy section
  headings, pink example boxes and clouds, cream ruled paper.

### 14.6 Planner

`SCHEMA_RULES` documents the new kinds, fields, inks, styles, the icon marker and the icon
vocabulary (`ICON_VOCAB`), the `hero`/`subtitle`/cover fields, and two recipes: the service
page (title + subtitle + intro + hero, key-concept icon cards, section + service-diagram
pairs, comparison table, takeaways checkbox list, tip sticky, cover page first when the
series has one) and the theory page (title with intro, definition sections with example
boxes, schema/table diagrams, comparison table, quick-notes cloud).

### 14.7 Out of scope

Editor forms for the new fields; hand-drawn roughening of logo SVGs (they render clean, as the
reference's logos do); Windows/Azure/Oracle marks (not in any package).

## 15. Addendum: the planner keeps up (6 Sep, evening)

The renderer grew faster than the prompts. Audit and fixes:

- **One rules module.** `lib/ai/rules.ts` holds `SCHEMA_RULES`, `RECIPE_GUIDANCE` and
  `PRESERVE_RULE`; plan, densify, fit, headings and revise all import it. Revise used to list
  the nine original block types and fit sent no rules at all, so either could silently drop
  `hero`, `icon`, `frame`, `style` or a diagram spec. The preserve rule names every such field.
- **Coverage reads diagrams.** `postText()` in `fit.ts` flattens every string in a diagram spec,
  so a point taught in cards, a chain, a schema or an ER diagram is no longer "dropped".
- **Family recipes.** Every manifest carries a `recipe` paragraph; `familyRecipe(template)` puts
  it in the slide prompt as `FAMILY "<name>": …`. The planner now knows study-sheet frames every
  section, sketchnote wants a hero and icon cards, marker-notes wants pink example boxes.
- **Reference layouts are hints.** The prompt asks for the reference page's density and section
  order but lets the model pick the best block per point (array, cards, schema, flowchart).
- **Topic mode has a shape.** The book stage gives each chapter a `shape` (ordered section roles:
  definition, mechanism, example, comparison, mistakes, summary, cheatsheet, cover); the slide
  prompt builds a page from it when there is no layout. The studio's Book drawer gained a
  "Build from topic" entry.
- **Refusals and warnings.** Reference reading passes `needsTools`, so the local model refuses
  instead of hallucinating pages it cannot see. The render report lists icon names that resolve
  to nothing (markers, card and node icons, hero, cover).
- **Editor.** The add-block menu offers a starter for every diagram kind and a sticky. Settings
  picks the default template from the built families.
- **Spillover merges.** A re-spill from part N into its own follow-up keeps the chapters the
  follow-up already held that N no longer covers (an overwrite lost nine AWS pages once).

Still open: per-page planning (one prompt per chapter with a running summary, which also makes
the 32k-context local model viable), an automatic densify/headings pass after render for pages
under ~85% and "(cont.)" titles, editor forms for cover/hero/subtitle, and documenting that the
reference downloader needs the media server on port 3000.

### 15.4 Topic-mode validation (Docker, 6 Sep 2026)

A "Docker Complete Notes" run on `sketchnote` with no references exercised the per-page
planner end to end: 14 chapters planned in parallel (306 s), rendered with polish into
three parts (10 + 10 + 4 pages, zero overflow, fills 88–100%). It exposed four defects,
all fixed:

- spillover stacked caption prefixes ("Part 3 of X. Part 2 of X. …") — the old prefix is
  now stripped before the new one is added;
- polish only ran on the part the click targeted — it now cascades into the follow-up
  part a spill minted (`polishFollowUps:false` opts out);
- the planner typed parens around subtitles and templates added their own ("((…))") —
  the page chrome strips them;
- each chapter flowed onto ~1.7 pages — the per-page prompt now states the one-page
  budget in blocks (8–11 with an icon-card strip or flowchart, 12–16 text-only).

Still open: a local-model (`qwen3.8:27b`) run of the per-page planner; the reference
media server on port 3000 is an undocumented dependency of reference mode; diagram
specs in the editor are still JSON textareas.
