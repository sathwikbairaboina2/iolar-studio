# Handbook Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every handbook template the vocabulary of a handwritten study sheet — inline highlight/colour markup, list styles, framed sections, sticky notes, syntax-coloured non-wrapping code, tinted tables, five diagram kinds — plus a new `study-sheet` family cloned from the reference chrome, and teach the planner to use all of it.

**Architecture:** Blocks stay template-agnostic: `lib/renderer/blocks.ts` (with new `inline.ts`, `syntax.ts`, `diagrams.ts`) emits HTML; `templates/_shared/base.css` styles it with each family's `--ink-*` variables; `templates/_shared/jitter.js` and a new `templates/_shared/diagrams.js` draw rough frames, sticky rotation and flowchart edges in the browser before the screenshot. Schema changes are all optional fields, so stored posts validate unchanged. The planner learns the vocabulary through `SCHEMA_RULES` in `lib/ai/plan.ts`, which the densify/fit/revise passes already share.

**Tech Stack:** Next.js 15 app, TypeScript, zod, vitest (jsdom, `@/` alias to repo root), Playwright + sharp for renders, rough.js in the page.

**Spec:** `docs/superpowers/specs/2026-09-06-handbook-blocks-design.md`

## Global Constraints

- Branch `feat/handbook-blocks` in worktree `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`. Never `git add -A`; stage named files. Never bare `git stash`.
- Every new schema field is optional. Every stored `post.json` under `data/handbooks` must still pass `validatePost`.
- `diagram.kind ∈ 'flow' | 'array' | 'flowchart' | 'matrix' | 'cards'`. `memory-cells`, `tree`, `compare` are removed.
- Inks: `blue | red | green | black | accent | purple | orange`. Every manifest declares all seven.
- Inline markers: `==hl==`, `**em**`, `__ul__`, `` `mono` ``, `{blue|red|green|black|purple|orange:text}`. Not applied to `heading.text`, `page_title`, `code.lines`.
- Code never wraps. Longest line > 34 chars forces full width; > 60 adds `code-small`; > 80 truncates at 80 with `…` and a warning.
- Jitter stays off for code. Seeded RNG order in `applyJitter`: character jitter, then sticky rotation, then rough frames.
- Run tests with `npx vitest run <files>` for targeted runs; the full suite needs `npx vitest run --maxWorkers=2` (Playwright + ffmpeg contention). Render e2e tests take up to 90 s each.
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ratp4wrh2heHexAoWeB26U
  ```

## File map

| File | Responsibility |
|---|---|
| `lib/schema.ts` (modify) | Ink/Frame enums, new optional fields, typed diagram specs, `study-sheet` in `TEMPLATES` |
| `lib/renderer/inline.ts` (create) | `escapeHtml`, `renderInline`, `stripInline` |
| `lib/renderer/syntax.ts` (create) | `tokenize`, `highlightLine` per language family |
| `lib/renderer/diagrams.ts` (create) | HTML for the five diagram kinds |
| `lib/renderer/blocks.ts` (modify) | block → HTML, list styles, frames, sticky, code rules, `forcesFullWidth`, `collectWarnings` |
| `lib/renderer/page.ts` (modify) | `TemplateManifest` type with `defaults`/`codeFont`, passes defaults to renderer, `code-hand` class |
| `lib/renderer/capture.ts` (modify) | `warnings` in `RenderResult` and `renderAll` results |
| `app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route.ts` (modify) | writes `warnings` into `render-report.json` |
| `lib/ai/fit.ts` (modify) | coverage text strips inline markers |
| `components/editor/DiffCard.tsx`, `components/editor/BlockForm.tsx` (modify) | strip markers in summaries; option lists updated |
| `templates/_shared/base.css` (modify) | default styles for every new class |
| `templates/_shared/jitter.js` (modify) | `.hl` atomic, dashed/diamond/pill rough shapes, sticky rotation |
| `templates/_shared/diagrams.js` (create) | flowchart edge overlay |
| `templates/_shared/layout.js` (modify) | calls `drawFlowchartEdges` after placement |
| `templates/*/template.html` (modify, 8 files) | include `diagrams.js` |
| `templates/*/manifest.json` (modify, 8 files) | `purple`, `orange` inks |
| `templates/study-sheet/{template.html,manifest.json}` (create) | the ninth family |
| `lib/ai/plan.ts` (modify) | `SCHEMA_RULES` exported and extended; recipe guidance |
| tests: `tests/inline.test.ts`, `tests/syntax.test.ts`, `tests/diagrams.test.ts`, `tests/plan.rules.test.ts` (create); `tests/schema.test.ts`, `tests/blocks.test.ts`, `tests/templates.test.ts`, `tests/fit.test.ts`, `tests/render.e2e.test.ts` (modify) |

---

### Task 1: Schema — inks, frames, list styles, sticky, code note, typed diagrams, study-sheet

**Files:**
- Modify: `lib/schema.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces: `Ink`, `Frame`, `BulletStyle`, `DiagramSpec` types; `Block` union with the new optional fields; `TEMPLATES` including `'study-sheet'`; `INKS` and `FRAMES` const arrays.

- [ ] **Step 1: Write the failing tests**

Append to `tests/schema.test.ts`:

```ts
describe('block additions', () => {
  const withBlock = (block: unknown) => ({
    ...minimal, slides: [{ page_title: 'P', blocks: [block] }],
  });

  it('accepts list styles, frames and inks on bullets', () => {
    const p = validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'number', frame: 'dashed', ink: 'purple' }));
    const b = p.slides[0].blocks[0];
    expect(b).toMatchObject({ style: 'number', frame: 'dashed', ink: 'purple' });
  });

  it('rejects an unknown list style', () => {
    expect(() => validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'star' }))).toThrow();
  });

  it('accepts frame and ink on paragraph, highlightRow on table, note on code', () => {
    validatePost(withBlock({ type: 'paragraph', text: 'x', frame: 'solid', ink: 'orange' }));
    validatePost(withBlock({ type: 'table', headers: ['a'], rows: [['1']], highlightRow: 0, frame: 'dashed' }));
    validatePost(withBlock({ type: 'code', lang: 'java', lines: ['int x;'], note: 'sorted only' }));
  });

  it('rejects a negative highlightRow', () => {
    expect(() => validatePost(withBlock({ type: 'table', headers: ['a'], rows: [['1']], highlightRow: -1 }))).toThrow();
  });

  it('accepts sticky callouts', () => {
    validatePost(withBlock({ type: 'callout', style: 'sticky', title: 'T', text: 't' }));
    validatePost(withBlock({ type: 'callout', style: 'sticky-pink', title: 'T', text: 't' }));
  });

  it('accepts every diagram kind with its spec', () => {
    validatePost(withBlock({ type: 'diagram', kind: 'flow', spec: { nodes: ['a', { text: 'b', sub: 's', ink: 'green' }] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'array', spec: { cells: ['2', '5'], pointers: [{ index: 0, label: 'low' }], highlight: [1], dim: [], caption: 'c' } }));
    validatePost(withBlock({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['s'], ['d'], ['l', 'r']],
      nodes: { s: { text: 'Start' }, d: { text: 'ok?', shape: 'diamond' }, l: { text: 'L' }, r: { text: 'R', ink: 'red' } },
      edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'l', label: 'yes' }, { from: 'd', to: 'r', label: 'no' }],
    } }));
    validatePost(withBlock({ type: 'diagram', kind: 'matrix', spec: { rows: [['1', '2'], ['3', '4']], highlight: [[0, 1]] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'A', lines: ['x'] }, { title: 'B', lines: ['y'], ink: 'blue' }] } }));
  });

  it('rejects removed diagram kinds and wrong specs', () => {
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'memory-cells', spec: {} }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'array', spec: { nodes: ['a'] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'only one', lines: ['x'] }] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'flowchart', spec: { rows: [['a']], nodes: { a: { text: 'a' } }, edges: [{ from: 'a', to: 'zzz' }] } }))).toThrow();
  });

  it('accepts study-sheet as a template', () => {
    validatePost({ ...minimal, template: 'study-sheet' });
  });

  it('still validates every stored post', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('fs');
    const path = await import('path');
    const root = path.join(process.cwd(), 'data', 'handbooks');
    if (!existsSync(root)) return;
    for (const subject of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const sdir = path.join(root, subject.name);
      for (const chapter of readdirSync(sdir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const parts = path.join(sdir, chapter.name, 'parts');
        if (!existsSync(parts)) continue;
        for (const part of readdirSync(parts)) {
          const f = path.join(parts, part, 'post.json');
          if (existsSync(f)) expect(() => validatePost(JSON.parse(readFileSync(f, 'utf8')))).not.toThrow();
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — `style`/`frame` stripped or rejected, `study-sheet` rejected, `array` kind rejected.

- [ ] **Step 3: Rewrite the block schema**

Replace the block section of `lib/schema.ts` (from `export const TEMPLATES` through `BlockSchema`) with:

```ts
export const TEMPLATES = [
  'spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel',
  'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall', 'study-sheet',
] as const;

export const INKS = ['blue', 'red', 'green', 'black', 'accent', 'purple', 'orange'] as const;
export const FRAMES = ['none', 'solid', 'dashed'] as const;
export const BULLET_STYLES = ['dot', 'number', 'check', 'cross'] as const;
export const DIAGRAM_KINDS = ['flow', 'array', 'flowchart', 'matrix', 'cards'] as const;

const Ink = z.enum(INKS);
const Frame = z.enum(FRAMES);
export type Ink = z.infer<typeof Ink>;
export type Frame = z.infer<typeof Frame>;
export type BulletStyle = (typeof BULLET_STYLES)[number];

const FlowNode = z.union([z.string().min(1), z.object({ text: z.string().min(1), sub: z.string().optional(), ink: Ink.optional() })]);

export const DiagramSpecs = {
  flow: z.object({ nodes: z.array(FlowNode).min(1) }),
  array: z.object({
    cells: z.array(z.string()).min(1).max(20),
    indices: z.boolean().default(true),
    pointers: z.array(z.object({ index: z.number().int().min(0), label: z.string().min(1), ink: Ink.optional() })).default([]),
    highlight: z.array(z.number().int().min(0)).default([]),
    dim: z.array(z.number().int().min(0)).default([]),
    caption: z.string().optional(),
  }),
  flowchart: z
    .object({
      rows: z.array(z.array(z.string().min(1)).min(1).max(3)).min(2).max(7),
      nodes: z.record(z.string(), z.object({ text: z.string().min(1), shape: z.enum(['box', 'diamond', 'pill']).default('box'), ink: Ink.optional() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
    })
    .superRefine((s, ctx) => {
      const ids = new Set(s.rows.flat());
      if (ids.size > 12) ctx.addIssue({ code: 'custom', message: 'flowchart: at most 12 nodes' });
      for (const id of ids) if (!s.nodes[id]) ctx.addIssue({ code: 'custom', message: `flowchart: row references unknown node "${id}"` });
      for (const e of s.edges) for (const id of [e.from, e.to]) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `flowchart: edge references node "${id}" that is not in rows` });
    }),
  matrix: z.object({
    rows: z.array(z.array(z.string()).min(1)).min(1),
    highlight: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).default([]),
    caption: z.string().optional(),
  }),
  cards: z.object({
    cards: z.array(z.object({ title: z.string().min(1), lines: z.array(z.string()).min(1), ink: Ink.optional() })).min(2).max(4),
  }),
} as const;

export type DiagramSpec = { [K in keyof typeof DiagramSpecs]: { kind: K; spec: z.infer<(typeof DiagramSpecs)[K]> } }[keyof typeof DiagramSpecs];

const DiagramSchema = z.discriminatedUnion('kind', [
  z.object({ type: z.literal('diagram'), kind: z.literal('flow'), spec: DiagramSpecs.flow }),
  z.object({ type: z.literal('diagram'), kind: z.literal('array'), spec: DiagramSpecs.array }),
  z.object({ type: z.literal('diagram'), kind: z.literal('flowchart'), spec: DiagramSpecs.flowchart }),
  z.object({ type: z.literal('diagram'), kind: z.literal('matrix'), spec: DiagramSpecs.matrix }),
  z.object({ type: z.literal('diagram'), kind: z.literal('cards'), spec: DiagramSpecs.cards }),
]);

const BlockSchema = z.union([
  z.object({ type: z.literal('heading'), text: z.string().min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1)).min(1), style: z.enum(BULLET_STYLES).optional(), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('sidebox'), title: z.string(), items: z.array(z.string()).min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1), highlightRow: z.number().int().min(0).optional(), frame: Frame.optional() }),
  z.object({ type: z.literal('code'), lang: z.string().default('python'), lines: z.array(z.string()).min(1), note: z.string().optional() }),
  DiagramSchema,
  z.object({ type: z.literal('callout'), style: z.enum(['tip', 'takeaway', 'cloud', 'sticky', 'sticky-pink']), title: z.string(), text: z.string() }),
  z.object({ type: z.literal('qa'), q: z.string(), a_bullets: z.array(z.string()).min(1), example_code: z.array(z.string()).optional() }),
]);
```

`z.union` replaces `z.discriminatedUnion('type', …)` because the diagram member is itself a discriminated union on `kind`; zod cannot nest discriminators on different keys. Error messages stay usable because every non-diagram member fails fast on `type`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/schema.test.ts tests/blocks.test.ts tests/fit.test.ts`
Expected: schema PASS. `blocks.test.ts` may fail on the removed `memory-cells` reference only if it uses one (it does not). Fix any `Block` type errors with `npx tsc --noEmit -p .` — `lib/renderer/blocks.ts` `diagram()` still compiles because it only reads `b.kind` and `b.spec`.

- [ ] **Step 5: Commit**

```bash
git add lib/schema.ts tests/schema.test.ts
git commit -m "feat(schema): list styles, frames, sticky callouts, code notes, typed diagram specs, study-sheet"
```

---

### Task 2: Inline markup module

**Files:**
- Create: `lib/renderer/inline.ts`
- Modify: `lib/renderer/blocks.ts:1-12` (import `escapeHtml` from inline, keep re-export)
- Modify: `lib/ai/fit.ts:22-40` (`postText` strips markers)
- Modify: `components/editor/DiffCard.tsx:6-18` (`blockText` strips markers)
- Test: `tests/inline.test.ts`, `tests/fit.test.ts`

**Interfaces:**
- Produces: `escapeHtml(s): string`, `renderInline(s): string`, `stripInline(s): string`, `INLINE_INKS` const.

- [ ] **Step 1: Write the failing tests**

Create `tests/inline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderInline, stripInline } from '@/lib/renderer/inline';

describe('renderInline', () => {
  it('escapes HTML before applying markers', () => {
    expect(renderInline('<b>==x==</b>')).toBe('&lt;b&gt;<mark class="hl">x</mark>&lt;/b&gt;');
  });
  it('renders every marker', () => {
    expect(renderInline('==hl==')).toBe('<mark class="hl">hl</mark>');
    expect(renderInline('**em**')).toBe('<span class="em">em</span>');
    expect(renderInline('__ul__')).toBe('<span class="ul">ul</span>');
    expect(renderInline('`x`')).toBe('<code class="mono">x</code>');
    expect(renderInline('{green:ok}')).toBe('<span class="ink-green">ok</span>');
    expect(renderInline('{purple:p} {orange:o}')).toBe('<span class="ink-purple">p</span> <span class="ink-orange">o</span>');
  });
  it('leaves unmatched markers and unknown inks literal', () => {
    expect(renderInline('a == b')).toBe('a == b');
    expect(renderInline('2 ** 3')).toBe('2 ** 3');
    expect(renderInline('{accent:x}')).toBe('{accent:x}');
    expect(renderInline('{pink:x}')).toBe('{pink:x}');
  });
  it('protects code spans from other markers', () => {
    expect(renderInline('`__init__`')).toBe('<code class="mono">__init__</code>');
    expect(renderInline('call `a**b` now')).toBe('call <code class="mono">a**b</code> now');
  });
  it('does not cross lines', () => {
    expect(renderInline('==a\nb==')).toBe('==a\nb==');
  });
  it('allows a highlight inside emphasis', () => {
    expect(renderInline('**==x==**')).toBe('<span class="em"><mark class="hl">x</mark></span>');
  });
});

describe('stripInline', () => {
  it('removes every marker and keeps the text', () => {
    expect(stripInline('==a== **b** __c__ `d` {red:e} f')).toBe('a b c d e f');
  });
  it('leaves unmatched markers alone', () => {
    expect(stripInline('a == b')).toBe('a == b');
  });
});
```

Add to `tests/fit.test.ts` inside a new describe at the end:

```ts
describe('uncoveredPoints ignores inline markers', () => {
  it('a highlighted keyword still counts as covered', async () => {
    const { uncoveredPoints } = await import('@/lib/ai/fit');
    const book = { title: 't', summary: 's', chapters: [{ title: 'c', points: ['binary search needs a sorted array'] }] } as never;
    const post = base();
    post.slides[0].blocks = [{ type: 'paragraph', text: 'Binary search needs a ==sorted array== to __work__' }];
    expect(uncoveredPoints(book, post)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/inline.test.ts tests/fit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/renderer/inline.ts`**

```ts
/** Inline markers inside block strings. Escaped first, then marked up, so text can never inject HTML. */
export const INLINE_INKS = ['blue', 'red', 'green', 'black', 'purple', 'orange'] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INK_RE = new RegExp(`\\{(${INLINE_INKS.join('|')}):([^{}\\n]+?)\\}`, 'g');
const MARKERS: [RegExp, string][] = [
  [/==([^=\n]+?)==/g, '<mark class="hl">$1</mark>'],
  [/\*\*([^*\n]+?)\*\*/g, '<span class="em">$1</span>'],
  [/__([^_\n]+?)__/g, '<span class="ul">$1</span>'],
  [INK_RE, '<span class="ink-$1">$2</span>'],
];

/** Code spans are lifted out first so `__init__` or `a**b` inside them stay literal. */
function splitCode(s: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const text = s.replace(/`([^`\n]+?)`/g, (_, inner: string) => {
    codes.push(inner);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return { text, codes };
}

export function renderInline(s: string): string {
  const { text, codes } = splitCode(escapeHtml(s));
  let out = text;
  for (const [re, rep] of MARKERS) out = out.replace(re, rep);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code class="mono">${codes[Number(i)]}</code>`);
}

export function stripInline(s: string): string {
  const { text, codes } = splitCode(s);
  let out = text;
  for (const [re, rep] of MARKERS) out = out.replace(re, rep.includes('$2') ? '$2' : '$1');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}
```

- [ ] **Step 4: Wire `escapeHtml` and `stripInline`**

In `lib/renderer/blocks.ts` replace lines 1-12 (the local `escapeHtml`) with:

```ts
import type { Block } from '../schema';
import { escapeHtml, renderInline } from './inline';
export { escapeHtml };

const e = escapeHtml;
const t = renderInline;
```

In `lib/ai/fit.ts` add `import { stripInline } from '../renderer/inline';` and change the last line of `postText` to `return stripInline(parts.join(' ')).toLowerCase();`.

In `components/editor/DiffCard.tsx` add `import { stripInline } from '@/lib/renderer/inline';` and wrap: rename the existing switch function to `rawBlockText` and add

```ts
function blockText(b?: Block): string {
  return stripInline(rawBlockText(b));
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/inline.test.ts tests/fit.test.ts tests/blocks.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/renderer/inline.ts lib/renderer/blocks.ts lib/ai/fit.ts components/editor/DiffCard.tsx tests/inline.test.ts tests/fit.test.ts
git commit -m "feat(renderer): inline highlight, emphasis, underline, mono and ink markers"
```

---

### Task 3: Syntax tokenizer

**Files:**
- Create: `lib/renderer/syntax.ts`
- Test: `tests/syntax.test.ts`

**Interfaces:**
- Produces: `type Token = { cls: 'kw'|'cm'|'str'|'num'|'fn'|null; text: string }`, `tokenize(lang: string, line: string): Token[]`, `highlightLine(lang: string, line: string): string` (HTML with `<span class="tk-…">`, text escaped).

- [ ] **Step 1: Write the failing tests**

Create `tests/syntax.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize, highlightLine } from '@/lib/renderer/syntax';

const classes = (lang: string, line: string) => tokenize(lang, line).filter((t) => t.cls).map((t) => `${t.cls}:${t.text}`);

describe('tokenize', () => {
  it('python: keywords, comment, string, number, function call', () => {
    expect(classes('python', 'if x == 1: print("hi")  # note')).toEqual([
      'kw:if', 'num:1', 'fn:print', 'str:"hi"', 'cm:# note',
    ]);
  });
  it('c-like: java keywords and // comment', () => {
    expect(classes('java', 'int mid = low + (high - low) / 2; // safe')).toEqual(['kw:int', 'num:2', 'cm:// safe']);
    expect(classes('js', "return fetch('/x')")).toEqual(['kw:return', 'fn:fetch', "str:'/x'"]);
  });
  it('sql: keywords are case-insensitive and -- comments', () => {
    expect(classes('sql', "select * from users where id = 5 -- all")).toEqual(['kw:select', 'kw:from', 'kw:where', 'num:5', 'cm:-- all']);
  });
  it('shell: # comment, no keyword for plain words', () => {
    expect(classes('bash', 'ls -la | grep foo # list')).toEqual(['cm:# list']);
  });
  it('unknown language gets only comments and strings', () => {
    expect(classes('brainfuck', 'if "x" // y')).toEqual(['str:"x"', 'cm:// y']);
  });
  it('a hash inside a string is not a comment', () => {
    expect(classes('python', 'a = "#tag"')).toEqual(['str:"#tag"']);
  });
  it('keeps every character of the line in order', () => {
    const line = 'while (low <= high) {  // loop';
    expect(tokenize('c', line).map((t) => t.text).join('')).toBe(line);
  });
});

describe('highlightLine', () => {
  it('escapes and wraps', () => {
    expect(highlightLine('python', 'if a < b: # c')).toBe('<span class="tk-kw">if</span> a &lt; b: <span class="tk-cm"># c</span>');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/syntax.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/renderer/syntax.ts`**

```ts
import { escapeHtml } from './inline';

export type TokenClass = 'kw' | 'cm' | 'str' | 'num' | 'fn' | null;
export type Token = { cls: TokenClass; text: string };

type Family = 'c' | 'python' | 'sql' | 'shell' | 'none';

const FAMILY: Record<string, Family> = {
  c: 'c', cpp: 'c', 'c++': 'c', java: 'c', js: 'c', javascript: 'c', ts: 'c', typescript: 'c', go: 'c', rust: 'c',
  kotlin: 'c', swift: 'c', csharp: 'c', 'c#': 'c', php: 'c', dart: 'c', scala: 'c',
  python: 'python', py: 'python', ruby: 'python',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql',
  shell: 'shell', bash: 'shell', sh: 'shell', zsh: 'shell', powershell: 'shell', ps1: 'shell',
};

const KW: Record<Family, string[]> = {
  c: 'int long double float char boolean bool void var let const function return if else for while do break continue switch case default new class interface extends implements import export from static public private protected final this null true false try catch finally throw async await fn pub struct enum impl mut match use go defer func package type map range nil'.split(' '),
  python: 'def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda yield pass break continue global nonlocal print len range assert del'.split(' '),
  sql: 'select from where insert into values update set delete join inner left right on group by order having limit offset as and or not null is in like between create table drop alter index primary key union distinct count sum avg min max case when then else end'.split(' '),
  shell: [],
  none: [],
};

const LINE_COMMENT: Record<Family, string[]> = {
  c: ['//', '/*'], python: ['#'], sql: ['--', '/*'], shell: ['#'], none: ['//', '#', '--'],
};

export function familyOf(lang: string): Family {
  return FAMILY[lang.toLowerCase()] ?? 'none';
}

export function tokenize(lang: string, line: string): Token[] {
  const fam = familyOf(lang);
  const kws = new Set(KW[fam]);
  const ci = fam === 'sql';
  const out: Token[] = [];
  let plain = '';
  const flush = () => { if (plain) { out.push({ cls: null, text: plain }); plain = ''; } };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const starter = LINE_COMMENT[fam].find((c) => line.startsWith(c, i));
    if (starter) { flush(); out.push({ cls: 'cm', text: line.slice(i) }); break; }
    if (ch === '"' || ch === "'" || (fam === 'c' && ch === '`')) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      flush(); out.push({ cls: 'str', text: line.slice(i, Math.min(j + 1, line.length)) }); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_]/.test(line[i - 1] ?? ' ')) {
      const m = /^\d+(\.\d+)?/.exec(line.slice(i))!;
      flush(); out.push({ cls: 'num', text: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i))!;
      const word = m[0];
      const key = ci ? word.toLowerCase() : word;
      const next = line.slice(i + word.length).match(/^\s*\(/);
      flush();
      if (kws.has(key)) out.push({ cls: 'kw', text: word });
      else if (next && fam !== 'none' && fam !== 'shell') out.push({ cls: 'fn', text: word });
      else out.push({ cls: null, text: word });
      i += word.length; continue;
    }
    plain += ch; i++;
  }
  flush();
  return out;
}

export function highlightLine(lang: string, line: string): string {
  return tokenize(lang, line)
    .map((tk) => (tk.cls ? `<span class="tk-${tk.cls}">${escapeHtml(tk.text)}</span>` : escapeHtml(tk.text)))
    .join('');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/syntax.test.ts`
Expected: PASS. If the python `print` case yields `kw:print` instead of `fn:print`, remove `print` from the python keyword list (the keyword check runs first).

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/syntax.ts tests/syntax.test.ts
git commit -m "feat(renderer): line tokenizer for c-like, python, sql and shell code"
```

---

### Task 4: Diagram renderers

**Files:**
- Create: `lib/renderer/diagrams.ts`
- Test: `tests/diagrams.test.ts`

**Interfaces:**
- Consumes: `renderInline` from Task 2, `DiagramSpec`/`Block` types from Task 1.
- Produces: `renderDiagram(b: Extract<Block, {type:'diagram'}>): string`. HTML skeletons (class names are the contract for `base.css`, `jitter.js`, `diagrams.js`):
  - flow: `div.b-diagram > div.dg-flow > span.dg-node[data-rough]…` with `span.dg-arrow` between; object nodes add `div.dg-sub`.
  - array: `div.b-diagram.dg-array > div.ar-grid > (div.ar-idx*, div.ar-cell[data-rough]*, div.ar-ptr*)` + optional `div.ar-caption[data-rough]`.
  - flowchart: `div.b-diagram.dg-flowchart[data-edges=JSON] > div.fc-row* > div.fc-node[data-id][data-rough][data-rough-shape]` + `svg.fc-edges`.
  - matrix: `div.b-diagram.dg-matrix > table.mx > tr > td(.mx-hl)` + caption.
  - cards: `div.b-diagram.dg-cards > div.card[data-rough] > (div.card-title, ul)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/diagrams.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDiagram } from '@/lib/renderer/diagrams';
import type { Block } from '@/lib/schema';

type D = Extract<Block, { type: 'diagram' }>;

describe('renderDiagram', () => {
  it('flow: string and object nodes, arrows between', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flow', spec: { nodes: ['a', { text: 'b', sub: 'why', ink: 'green' }] } } as D);
    expect(h).toContain('dg-flow');
    expect((h.match(/dg-node/g) ?? []).length).toBe(2);
    expect((h.match(/dg-arrow/g) ?? []).length).toBe(1);
    expect(h).toContain('dg-sub');
    expect(h).toContain('var(--ink-green)');
  });

  it('array: indices, cells, highlight, dim, pointers and caption', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'array', spec: {
      cells: ['2', '5', '8'], indices: true, pointers: [{ index: 0, label: 'low' }, { index: 2, label: 'high', ink: 'red' }], highlight: [1], dim: [2], caption: 'found',
    } } as D);
    expect(h).toContain('dg-array');
    expect((h.match(/class="ar-idx"/g) ?? []).length).toBe(3);
    expect((h.match(/ar-cell/g) ?? []).length).toBe(3);
    expect(h).toContain('ar-cell ar-hl');
    expect(h).toContain('ar-cell ar-dim');
    expect(h).toContain('low');
    expect(h).toContain('var(--ink-red)');
    expect(h).toContain('ar-caption');
    expect(h).toContain('--ar-cols:3');
  });

  it('array: no index row when indices is false', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'array', spec: { cells: ['1'], indices: false, pointers: [], highlight: [], dim: [] } } as D);
    expect(h).not.toContain('ar-idx');
  });

  it('flowchart: rows, shaped nodes and an edge list for the browser', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['s'], ['d'], ['l', 'r']],
      nodes: { s: { text: 'Start', shape: 'pill' }, d: { text: 'ok?', shape: 'diamond' }, l: { text: 'L', shape: 'box' }, r: { text: 'R', shape: 'box', ink: 'red' } },
      edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'l', label: 'yes' }, { from: 'd', to: 'r', label: 'no' }],
    } } as D);
    expect(h).toContain('dg-flowchart');
    expect((h.match(/fc-row/g) ?? []).length).toBe(3);
    expect(h).toContain('data-id="d"');
    expect(h).toContain('data-rough-shape="diamond"');
    expect(h).toContain('data-rough-shape="pill"');
    expect(h).toContain('fc-edges');
    expect(h).toContain('data-edges="');
    expect(h).toContain('&quot;label&quot;:&quot;yes&quot;');
  });

  it('matrix: cells and highlight', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'matrix', spec: { rows: [['1', '2'], ['3', '4']], highlight: [[1, 0]], caption: 'n=2' } } as D);
    expect(h).toContain('dg-matrix');
    expect((h.match(/<td/g) ?? []).length).toBe(4);
    expect(h).toContain('class="mx-hl"');
    expect(h).toContain('n=2');
  });

  it('cards: one box per card with title and lines', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'A', lines: ['x', 'y'] }, { title: 'B', lines: ['z'], ink: 'purple' }] } } as D);
    expect(h).toContain('dg-cards');
    expect((h.match(/class="card"/g) ?? []).length).toBe(2);
    expect(h).toContain('--card-cols:2');
    expect(h).toContain('var(--ink-purple)');
  });

  it('applies inline markup to labels and escapes html', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flow', spec: { nodes: ['==hot== <b>'] } } as D);
    expect(h).toContain('<mark class="hl">hot</mark>');
    expect(h).toContain('&lt;b&gt;');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/diagrams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/renderer/diagrams.ts`**

```ts
import type { Block } from '../schema';
import { escapeHtml, renderInline } from './inline';

type D = Extract<Block, { type: 'diagram' }>;
const t = renderInline;
const ink = (name?: string) => `var(--ink-${name ?? 'blue'})`;

function flow(spec: Extract<D, { kind: 'flow' }>['spec']): string {
  const inner = spec.nodes
    .map((n) => {
      if (typeof n === 'string') return `<span class="dg-node" data-rough="${ink()}" data-jitter>${t(n)}</span>`;
      const sub = n.sub ? `<div class="dg-sub">${t(n.sub)}</div>` : '';
      return `<span class="dg-node dg-node-rich" data-rough="${ink(n.ink)}" data-jitter><div class="dg-title">${t(n.text)}</div>${sub}</span>`;
    })
    .join('<span class="dg-arrow">→</span>');
  return `<div class="b-diagram"><div class="dg-flow">${inner}</div></div>`;
}

function array(spec: Extract<D, { kind: 'array' }>['spec']): string {
  const n = spec.cells.length;
  const hl = new Set(spec.highlight);
  const dim = new Set(spec.dim);
  const idx = spec.indices ? spec.cells.map((_, i) => `<div class="ar-idx">${i}</div>`).join('') : '';
  const cells = spec.cells
    .map((c, i) => `<div class="ar-cell${hl.has(i) ? ' ar-hl' : ''}${dim.has(i) ? ' ar-dim' : ''}" data-rough="${dim.has(i) ? 'var(--rule, #999)' : 'var(--ink-black)'}">${t(c)}</div>`)
    .join('');
  const byIndex = new Map<number, typeof spec.pointers>();
  for (const p of spec.pointers) byIndex.set(p.index, [...(byIndex.get(p.index) ?? []), p]);
  const ptrs = spec.cells
    .map((_, i) => {
      const ps = byIndex.get(i) ?? [];
      const labels = ps.map((p) => `<div class="ar-ptr-label" style="color:${ink(p.ink)}">${t(p.label)}</div>`).join('');
      return `<div class="ar-ptr">${ps.length ? `<div class="ar-ptr-arrow" style="color:${ink(ps[0].ink)}">↑</div>${labels}` : ''}</div>`;
    })
    .join('');
  const caption = spec.caption ? `<div class="ar-caption" data-rough="var(--ink-green)" data-jitter>${t(spec.caption)}</div>` : '';
  return `<div class="b-diagram dg-array" style="--ar-cols:${n}"><div class="ar-grid">${idx}${cells}${ptrs}</div>${caption}</div>`;
}

function flowchart(spec: Extract<D, { kind: 'flowchart' }>['spec']): string {
  const rows = spec.rows
    .map((ids) => {
      const nodes = ids
        .map((id) => {
          const nd = spec.nodes[id];
          return `<div class="fc-node fc-${nd.shape}" data-id="${escapeHtml(id)}" data-rough="${ink(nd.ink)}" data-rough-shape="${nd.shape}" data-jitter><span>${t(nd.text)}</span></div>`;
        })
        .join('');
      return `<div class="fc-row">${nodes}</div>`;
    })
    .join('');
  const edges = escapeHtml(JSON.stringify(spec.edges));
  return `<div class="b-diagram dg-flowchart" data-edges="${edges}">${rows}<svg class="fc-edges"></svg></div>`;
}

function matrix(spec: Extract<D, { kind: 'matrix' }>['spec']): string {
  const hl = new Set(spec.highlight.map(([r, c]) => `${r},${c}`));
  const body = spec.rows
    .map((row, r) => `<tr>${row.map((c, ci) => `<td${hl.has(`${r},${ci}`) ? ' class="mx-hl"' : ''} data-jitter>${t(c)}</td>`).join('')}</tr>`)
    .join('');
  const caption = spec.caption ? `<div class="mx-caption" data-jitter>${t(spec.caption)}</div>` : '';
  return `<div class="b-diagram dg-matrix"><table class="mx">${body}</table>${caption}</div>`;
}

function cards(spec: Extract<D, { kind: 'cards' }>['spec']): string {
  const items = spec.cards
    .map((c) => `<div class="card" data-rough="${ink(c.ink)}"><div class="card-title" style="color:${ink(c.ink)}" data-jitter>${t(c.title)}</div><ul data-jitter>${c.lines.map((l) => `<li>${t(l)}</li>`).join('')}</ul></div>`)
    .join('');
  return `<div class="b-diagram dg-cards" style="--card-cols:${spec.cards.length}">${items}</div>`;
}

export function renderDiagram(b: D): string {
  switch (b.kind) {
    case 'flow': return flow(b.spec);
    case 'array': return array(b.spec);
    case 'flowchart': return flowchart(b.spec);
    case 'matrix': return matrix(b.spec);
    case 'cards': return cards(b.spec);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/diagrams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/diagrams.ts tests/diagrams.test.ts
git commit -m "feat(renderer): array, flowchart, matrix and cards diagrams; rich flow nodes"
```

---

### Task 5: Block renderer — list styles, frames, sticky, tables, code rules, warnings, manifest defaults

**Files:**
- Modify: `lib/renderer/blocks.ts` (full rewrite below)
- Modify: `lib/renderer/page.ts`
- Test: `tests/blocks.test.ts`

**Interfaces:**
- Consumes: `renderInline`/`escapeHtml` (Task 2), `highlightLine` (Task 3), `renderDiagram` (Task 4).
- Produces:
  - `type RenderOpts = { defaults?: { frame?: Frame } }`
  - `renderBlockHtml(block: Block, opts?: RenderOpts): string`
  - `renderSlideBlocks(blocks: Block[], opts?: RenderOpts): string`
  - `forcesFullWidth(block: Block): boolean` (exported)
  - `collectWarnings(blocks: Block[]): string[]`
  - `CODE_FULL_AT = 34`, `CODE_SMALL_AT = 60`, `CODE_TRUNCATE_AT = 80`
  - `page.ts`: `type TemplateManifest = { name: string; contentSelector: string; inks: Record<string,string>; maxColumns?: number; columnGap?: string; defaults?: { frame?: Frame }; codeFont?: 'mono'|'hand' }`; `templateManifest(template): TemplateManifest`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/blocks.test.ts`:

```ts
import { forcesFullWidth, collectWarnings } from '@/lib/renderer/blocks';

describe('list styles and frames', () => {
  it('numbered lists use circled digits', () => {
    const h = renderBlockHtml({ type: 'bullets', items: ['a', 'b'], style: 'number' } as Block);
    expect(h).toContain('bl-number');
    expect(h).toContain('①');
    expect(h).toContain('②');
  });
  it('check and cross lists carry their glyph class', () => {
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], style: 'check' } as Block)).toContain('bl-check');
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], style: 'cross' } as Block)).toContain('bl-cross');
  });
  it('a framed block is wrapped in a rough frame with its ink and dash flag', () => {
    const h = renderBlockHtml({ type: 'bullets', items: ['a'], frame: 'dashed', ink: 'purple' } as Block);
    expect(h).toMatch(/<div class="b-frame" data-rough="var\(--ink-purple\)" data-rough-dash="1">/);
    const solid = renderBlockHtml({ type: 'paragraph', text: 'p', frame: 'solid' } as Block);
    expect(solid).toContain('data-rough="var(--ink-blue)"');
    expect(solid).not.toContain('data-rough-dash');
  });
  it('manifest defaults apply only when the block leaves frame unset', () => {
    const d = { defaults: { frame: 'dashed' as const } };
    expect(renderBlockHtml({ type: 'bullets', items: ['a'] } as Block, d)).toContain('b-frame');
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], frame: 'none' } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'heading', text: 'h' } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'code', lang: 'py', lines: ['x'] } as Block, d)).not.toContain('b-frame');
  });
  it('bullet items carry inline markup', () => {
    expect(renderBlockHtml({ type: 'bullets', items: ['==a=='] } as Block)).toContain('<mark class="hl">a</mark>');
  });
});

describe('tables', () => {
  it('highlights the requested row', () => {
    const h = renderBlockHtml({ type: 'table', headers: ['a'], rows: [['1'], ['2']], highlightRow: 1 } as Block);
    expect(h).toContain('<tr class="hl-row"><td data-jitter>2</td></tr>');
    expect(h).not.toContain('<tr class="hl-row"><td data-jitter>1</td>');
  });
});

describe('sticky callouts', () => {
  it('render as a note with a pin and no rough frame', () => {
    const h = renderBlockHtml({ type: 'callout', style: 'sticky', title: 'T', text: 'x' } as Block);
    expect(h).toContain('co-sticky');
    expect(h).not.toContain('data-rough');
    expect(h).toContain('co-pin');
    expect(renderBlockHtml({ type: 'callout', style: 'sticky-pink', title: 'T', text: 'x' } as Block)).toContain('co-sticky-pink');
  });
});

describe('code rules', () => {
  const code = (lines: string[], extra = {}) => ({ type: 'code', lang: 'python', lines, ...extra }) as Block;
  it('colours tokens and keeps jitter off', () => {
    const h = renderBlockHtml(code(['if x: # c']));
    expect(h).toContain('tk-kw');
    expect(h).toContain('tk-cm');
    expect(h).not.toContain('data-jitter');
  });
  it('renders the note as a sticky inside the box', () => {
    const h = renderBlockHtml(code(['x'], { note: 'sorted ==only==' }));
    expect(h).toContain('code-note');
    expect(h).toContain('<mark class="hl">only</mark>');
    expect(h).toContain('has-note');
  });
  it('forces full width past 34 chars and steps down past 60', () => {
    expect(forcesFullWidth(code(['a'.repeat(34)]))).toBe(false);
    expect(forcesFullWidth(code(['a'.repeat(35)]))).toBe(true);
    expect(renderBlockHtml(code(['a'.repeat(61)]))).toContain('code-small');
    expect(renderBlockHtml(code(['a'.repeat(60)]))).not.toContain('code-small');
  });
  it('truncates past 80 chars and reports a warning', () => {
    const long = 'b'.repeat(90);
    const h = renderBlockHtml(code([long]));
    expect(h).toContain('b'.repeat(80) + '…');
    expect(h).not.toContain(long);
    expect(collectWarnings([code([long]), code(['ok'])])).toEqual(['block 0: code line 1 truncated at 80 chars']);
  });
});

describe('forcesFullWidth for diagrams', () => {
  const dg = (kind: string, spec: unknown) => ({ type: 'diagram', kind, spec }) as Block;
  it('array, flowchart and cards always; flow from 4 nodes; matrix past 4 columns', () => {
    expect(forcesFullWidth(dg('array', { cells: ['1'], indices: true, pointers: [], highlight: [], dim: [] }))).toBe(true);
    expect(forcesFullWidth(dg('flowchart', { rows: [['a'], ['b']], nodes: { a: { text: 'a', shape: 'box' }, b: { text: 'b', shape: 'box' } }, edges: [] }))).toBe(true);
    expect(forcesFullWidth(dg('cards', { cards: [{ title: 'a', lines: ['x'] }, { title: 'b', lines: ['y'] }] }))).toBe(true);
    expect(forcesFullWidth(dg('flow', { nodes: ['a', 'b', 'c'] }))).toBe(false);
    expect(forcesFullWidth(dg('flow', { nodes: ['a', 'b', 'c', 'd'] }))).toBe(true);
    expect(forcesFullWidth(dg('matrix', { rows: [['1', '2', '3', '4']], highlight: [] }))).toBe(false);
    expect(forcesFullWidth(dg('matrix', { rows: [['1', '2', '3', '4', '5']], highlight: [] }))).toBe(true);
  });
});
```

Also update the existing test `marks wide tables and diagrams as force-full`: replace the `diagram` case's spec with `{ nodes: ['a', 'b', 'c', 'd'] }` so it still expects `data-force-full`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/blocks.test.ts`
Expected: FAIL on the new describes.

- [ ] **Step 3: Rewrite `lib/renderer/blocks.ts`**

```ts
import type { Block, Frame } from '../schema';
import { escapeHtml, renderInline } from './inline';
import { highlightLine } from './syntax';
import { renderDiagram } from './diagrams';
export { escapeHtml };

const e = escapeHtml;
const t = renderInline;

export type RenderOpts = { defaults?: { frame?: Frame } };

export const CODE_FULL_AT = 34;
export const CODE_SMALL_AT = 60;
export const CODE_TRUNCATE_AT = 80;

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function inkVar(ink?: string) {
  return `var(--ink-${ink ?? 'blue'})`;
}

function heading(b: Extract<Block, { type: 'heading' }>) {
  const cls = b.ink ? ` ink-${b.ink}` : '';
  return `<div class="b-heading${cls}" data-jitter>${e(b.text)}</div>`;
}

function paragraph(b: Extract<Block, { type: 'paragraph' }>) {
  return `<div class="b-paragraph" data-jitter>${t(b.text)}</div>`;
}

function bullets(b: Extract<Block, { type: 'bullets' }>) {
  const style = b.style ?? 'dot';
  const items = b.items
    .map((item, i) => {
      const glyph = style === 'number' ? `<span class="bl-glyph">${CIRCLED[i] ?? `${i + 1}.`}</span>` : '';
      return `<li>${glyph}${t(item)}</li>`;
    })
    .join('');
  return `<ul class="b-bullets bl-${style}" data-jitter>${items}</ul>`;
}

function sidebox(b: Extract<Block, { type: 'sidebox' }>) {
  return (
    `<div class="b-sidebox" data-rough="${inkVar(b.ink ?? 'green')}">` +
    `<div class="sb-title" data-jitter>${t(b.title)}</div>` +
    `<ul data-jitter>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul></div>`
  );
}

function table(b: Extract<Block, { type: 'table' }>) {
  const head = `<tr>${b.headers.map((h) => `<th data-jitter>${t(h)}</th>`).join('')}</tr>`;
  const rows = b.rows
    .map((r, i) => `<tr${i === b.highlightRow ? ' class="hl-row"' : ''}>${r.map((c) => `<td data-jitter>${t(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="b-table">${head}${rows}</table>`;
}

function longestLine(lines: string[]): number {
  return lines.reduce((m, l) => Math.max(m, l.length), 0);
}

function code(b: Extract<Block, { type: 'code' }>) {
  // No jitter on code: legibility beats realism. Lines never wrap; long ones step down or truncate.
  const lines = b.lines.map((l) => (l.length > CODE_TRUNCATE_AT ? l.slice(0, CODE_TRUNCATE_AT) + '…' : l));
  const cls = ['b-code', longestLine(lines) > CODE_SMALL_AT ? 'code-small' : '', b.note ? 'has-note' : ''].filter(Boolean).join(' ');
  const note = b.note ? `<div class="code-note co-sticky"><span class="co-pin">📌</span>${t(b.note)}</div>` : '';
  return `<div class="${cls}" data-lang="${e(b.lang)}">${note}<pre>${lines.map((l) => highlightLine(b.lang, l)).join('\n')}</pre></div>`;
}

function callout(b: Extract<Block, { type: 'callout' }>) {
  if (b.style === 'sticky' || b.style === 'sticky-pink') {
    return (
      `<div class="b-callout co-sticky${b.style === 'sticky-pink' ? ' co-sticky-pink' : ''}">` +
      `<span class="co-pin">📌</span>` +
      `<div class="co-title" data-jitter>${t(b.title)}</div>` +
      `<div class="co-text" data-jitter>${t(b.text)}</div></div>`
    );
  }
  const icon = b.style === 'tip' ? '💡 ' : b.style === 'takeaway' ? '★ ' : '';
  const ink = b.style === 'cloud' ? 'var(--ink-green)' : 'var(--ink-red)';
  return (
    `<div class="b-callout co-${b.style}" data-rough="${ink}">` +
    `<div class="co-title" data-jitter>${icon}${t(b.title)}</div>` +
    `<div class="co-text" data-jitter>${t(b.text)}</div></div>`
  );
}

function qa(b: Extract<Block, { type: 'qa' }>) {
  const codeHtml = b.example_code?.length
    ? `<div class="b-code"><pre>${b.example_code.map((l) => highlightLine('python', l)).join('\n')}</pre></div>`
    : '';
  return (
    `<div class="b-qa">` +
    `<div class="qa-q" data-jitter>${t(b.q)}</div>` +
    `<div class="qa-a"><span class="qa-ans-label" data-jitter>Ans→</span>` +
    `<ul data-jitter>${b.a_bullets.map((i) => `<li>${t(i)}</li>`).join('')}</ul></div>` +
    codeHtml +
    `</div>`
  );
}

function frameOf(block: Block, opts?: RenderOpts): Frame {
  if (block.type !== 'bullets' && block.type !== 'paragraph' && block.type !== 'table') return 'none';
  return block.frame ?? opts?.defaults?.frame ?? 'none';
}

function withFrame(block: Block, inner: string, opts?: RenderOpts): string {
  const frame = frameOf(block, opts);
  if (frame === 'none') return inner;
  const ink = 'ink' in block && block.ink ? block.ink : 'blue';
  const dash = frame === 'dashed' ? ' data-rough-dash="1"' : '';
  return `<div class="b-frame" data-rough="${inkVar(ink)}"${dash}>${inner}</div>`;
}

export function renderBlockHtml(block: Block, opts?: RenderOpts): string {
  let inner: string;
  switch (block.type) {
    case 'heading': inner = heading(block); break;
    case 'paragraph': inner = paragraph(block); break;
    case 'bullets': inner = bullets(block); break;
    case 'sidebox': inner = sidebox(block); break;
    case 'table': inner = table(block); break;
    case 'code': inner = code(block); break;
    case 'diagram': inner = renderDiagram(block); break;
    case 'callout': inner = callout(block); break;
    case 'qa': inner = qa(block); break;
  }
  return withFrame(block, inner, opts);
}

export function forcesFullWidth(block: Block): boolean {
  if (block.type === 'table') return block.headers.length >= 4;
  if (block.type === 'code') return longestLine(block.lines) > CODE_FULL_AT;
  if (block.type === 'diagram') {
    switch (block.kind) {
      case 'array': case 'flowchart': case 'cards': return true;
      case 'flow': return block.spec.nodes.length >= 4;
      case 'matrix': return block.spec.rows.some((r) => r.length > 4);
    }
  }
  return false;
}

/** Render-time warnings that do not block a render but the report should carry. */
export function collectWarnings(blocks: Block[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'code') {
      b.lines.forEach((l, li) => {
        if (l.length > CODE_TRUNCATE_AT) out.push(`block ${i}: code line ${li + 1} truncated at ${CODE_TRUNCATE_AT} chars`);
      });
    }
  });
  return out;
}

/** Wraps each block in a packing unit the layout engine can measure and place. */
export function renderSlideBlocks(blocks: Block[], opts?: RenderOpts): string {
  return blocks
    .map((b, i) => {
      const full = forcesFullWidth(b) ? ' data-force-full="1"' : '';
      return `<div class="pk-unit" data-block-index="${i}" data-block-type="${b.type}"${full}>${renderBlockHtml(b, opts)}</div>`;
    })
    .join('\n');
}
```

- [ ] **Step 4: Update `lib/renderer/page.ts`**

Replace `templateManifest` and the relevant lines of `buildSlideHtml`:

```ts
import type { Frame } from '../schema';

export type TemplateManifest = {
  name: string;
  contentSelector: string;
  inks: Record<string, string>;
  maxColumns?: number;
  columnGap?: string;
  defaults?: { frame?: Frame };
  codeFont?: 'mono' | 'hand';
};

export function templateManifest(template: string): TemplateManifest {
  return JSON.parse(readFileSync(path.join(templatesRoot(), template, 'manifest.json'), 'utf8'));
}
```

and in `buildSlideHtml`:

```ts
  const head =
    `<link rel="stylesheet" href="../_shared/fonts.css">` +
    `<link rel="stylesheet" href="../_shared/base.css">` +
    `<style>#content{--pk-cols:${columns};--pk-col-gap:${columnGap}}</style>`;

  const content = renderSlideBlocks(slide.blocks, { defaults: manifest.defaults });
  const codeClass = manifest.codeFont === 'hand' ? 'code-hand' : 'code-mono';
```

and at the end:

```ts
  return tpl
    .replace('<!--HEAD-->', head)
    .replace('<!--CONTENT-->', content)
    .replace('<!--PAGEVARS-->', pageVars)
    .replace('<div id="page">', `<div id="page" class="${codeClass}">`);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/blocks.test.ts tests/diagrams.test.ts tests/schema.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors. If `tsc` complains about the `switch` in `forcesFullWidth` not returning on all paths, add `return false;` after the inner switch.

- [ ] **Step 6: Commit**

```bash
git add lib/renderer/blocks.ts lib/renderer/page.ts tests/blocks.test.ts
git commit -m "feat(renderer): list styles, framed sections, sticky notes, tinted tables, code rules and manifest defaults"
```

---

### Task 6: Warnings in the render report

**Files:**
- Modify: `lib/renderer/capture.ts:34,58-64,97-103,140-142`
- Modify: `app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route.ts:11-23`
- Test: `tests/fit.test.ts` (no change needed), covered by Task 10 e2e

**Interfaces:**
- Produces: `RenderResult.warnings: string[]`; `renderAll().results[i].warnings: string[]`; `render-report.json` entries `{ overflowPx, fillPct, warnings? }`.

- [ ] **Step 1: Thread warnings through `capture.ts`**

```ts
import { renderSlideBlocks, collectWarnings } from './blocks';  // add collectWarnings to the existing import line

export type RenderResult = { overflowPx: number; fillPct: number; spillIndexes: number[]; neededPct: number; warnings: string[] };
```

In `renderSlide`, before `return { overflowPx, … }`:

```ts
      const warnings = collectWarnings(post.slides[slideIndex].blocks);
      return { overflowPx, fillPct, spillIndexes: layout.spillIndexes, neededPct: layout.neededPct, warnings };
```

In `renderAll`, change the result type in both the signature and the local `results` declaration to
`{ slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[]`, and the push to
`results.push({ slide: page + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: r.warnings });`.

- [ ] **Step 2: Persist warnings in the route**

In `writeReport` of the render route change the `results` parameter type to include `warnings?: string[]`, the `existing` type to `Record<string, { overflowPx: number; fillPct?: number; warnings?: string[] }>`, and the assignment to:

```ts
  for (const r of results) {
    existing[String(r.slide)] = { overflowPx: r.overflowPx, fillPct: r.fillPct, ...(r.warnings?.length ? { warnings: r.warnings } : {}) };
  }
```

Search the route for the single-slide `renderSlide` call and make sure its `results` object literal also passes `warnings: r.warnings`.

- [ ] **Step 3: Type-check and run the fit tests**

Run: `npx tsc --noEmit -p . && npx vitest run tests/fit.test.ts tests/package.test.ts`
Expected: no type errors, PASS. `packageExport` reads only `overflowPx`, so extra keys are ignored.

- [ ] **Step 4: Commit**

```bash
git add lib/renderer/capture.ts "app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route.ts"
git commit -m "feat(render): carry code truncation warnings into the render report"
```

---

### Task 7: Shared CSS and browser JS — styles, rough shapes, sticky rotation, flowchart edges

**Files:**
- Modify: `templates/_shared/base.css`
- Modify: `templates/_shared/jitter.js`
- Create: `templates/_shared/diagrams.js`
- Modify: `templates/_shared/layout.js:118-121`
- Modify: all 8 `templates/*/template.html` (add one script tag)
- Modify: all 8 `templates/*/manifest.json` (add `purple`, `orange`)
- Test: `tests/templates.test.ts`

**Interfaces:**
- Consumes the class names from Tasks 4-5.
- Produces: `window.drawFlowchartEdges(root: Document|Element)`; rough attributes `data-rough-dash="1"`, `data-rough-shape="diamond"|"pill"|"box"`.

- [ ] **Step 1: Write the failing template contract tests**

Replace `tests/templates.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { INKS, TEMPLATES } from '@/lib/schema';

const dir = path.join(process.cwd(), 'templates');
const templateDirs = readdirSync(dir).filter((d) => !d.startsWith('_'));

describe('template contract', () => {
  it('every schema template has a directory and vice versa', () => {
    expect([...templateDirs].sort()).toEqual([...TEMPLATES].sort());
  });

  it.each(templateDirs)('%s has required markers, scripts and manifest', (t) => {
    const html = readFileSync(path.join(dir, t, 'template.html'), 'utf8');
    expect(html).toContain('<!--CONTENT-->');
    expect(html).toContain('<!--PAGEVARS-->');
    expect(html).toContain('<!--HEAD-->');
    expect(html).toContain('<div id="page">');
    expect(html).toContain('../_shared/diagrams.js');
    const m = JSON.parse(readFileSync(path.join(dir, t, 'manifest.json'), 'utf8'));
    expect(m.name).toBe(t);
    expect(m.contentSelector).toBeTruthy();
    for (const ink of INKS) expect(m.inks[ink], `${t} missing ink ${ink}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it('shared assets exist', () => {
    for (const f of ['base.css', 'jitter.js', 'rough.min.js', 'fonts.css', 'pack.js', 'layout.js', 'diagrams.js'])
      expect(existsSync(path.join(dir, '_shared', f))).toBe(true);
  });

  it('base.css styles every new class', () => {
    const css = readFileSync(path.join(dir, '_shared', 'base.css'), 'utf8');
    for (const cls of ['.hl', '.em', '.ul', '.mono', '.bl-number', '.bl-check', '.bl-cross', '.b-frame', '.co-sticky', '.co-sticky-pink', '.code-note', '.code-small', '.tk-kw', '.tk-cm', '.tk-str', '.tk-num', '.tk-fn', '.hl-row', '.dg-array', '.ar-cell', '.ar-hl', '.ar-dim', '.dg-flowchart', '.fc-node', '.fc-diamond', '.fc-edges', '.dg-matrix', '.mx-hl', '.dg-cards', '.card', '.dg-node-rich', '--ink-purple', '--ink-orange'])
      expect(css, `base.css lacks ${cls}`).toContain(cls);
  });
});
```

This test also fails until Task 8 adds `study-sheet` (the first assertion). That is expected; run the rest with `-t` filters until then.

Also create `tests/flowchart.edges.test.ts` (jsdom; rects are all zero there, so only the structure is checked):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { renderDiagram } from '@/lib/renderer/diagrams';
import type { Block } from '@/lib/schema';

describe('drawFlowchartEdges', () => {
  it('draws one path per edge and a label text where given', () => {
    const src = readFileSync(path.join(process.cwd(), 'templates', '_shared', 'diagrams.js'), 'utf8');
    new Function(src)();
    document.body.innerHTML = renderDiagram({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['a'], ['b', 'c']],
      nodes: { a: { text: 'A', shape: 'box' }, b: { text: 'B', shape: 'box' }, c: { text: 'C', shape: 'diamond' } },
      edges: [{ from: 'a', to: 'b', label: 'yes' }, { from: 'a', to: 'c' }],
    } } as Extract<Block, { type: 'diagram' }>);
    (window as unknown as { drawFlowchartEdges: (r: Document) => void }).drawFlowchartEdges(document);
    const svg = document.querySelector('svg.fc-edges')!;
    expect(svg.querySelectorAll('path:not(marker path)').length).toBe(2);
    expect(svg.querySelectorAll('text.fc-label').length).toBe(1);
    expect(svg.querySelector('text.fc-label')!.textContent).toBe('yes');
  });
});
```

Run it with the Task 7 tests; it passes once `diagrams.js` exists. Note `path:not(marker path)` excludes the arrowhead inside `<marker>`; if jsdom rejects that selector, count `svg > path` instead.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/templates.test.ts`
Expected: FAIL — inks missing, `diagrams.js` missing, classes missing.

- [ ] **Step 3: Add inks to the eight manifests**

For each of `blackboard, engineer-grid, legal-pad, margin-qa, spiral-notes, sticky-wall, studygram-pastel, terminal-dark`, add two keys to `inks`. Pick from the family's own palette; defaults if unsure:

| family | purple | orange |
|---|---|---|
| spiral-notes, margin-qa, legal-pad, engineer-grid, studygram-pastel, sticky-wall | `#5b3fa0` | `#d97706` |
| blackboard | `#c9b6ff` | `#ffcc80` |
| terminal-dark | `#c792ea` | `#f78c6c` |

Run this once from the repo root to apply them:

```bash
node -e '
const fs=require("fs");
const dark={blackboard:["#c9b6ff","#ffcc80"],"terminal-dark":["#c792ea","#f78c6c"]};
for (const t of ["blackboard","engineer-grid","legal-pad","margin-qa","spiral-notes","sticky-wall","studygram-pastel","terminal-dark"]) {
  const p=`templates/${t}/manifest.json`; const m=JSON.parse(fs.readFileSync(p,"utf8"));
  const [pu,or]=dark[t]??["#5b3fa0","#d97706"]; m.inks.purple=pu; m.inks.orange=or;
  fs.writeFileSync(p, JSON.stringify(m,null,2)+"\n");
}'
```

- [ ] **Step 4: Include `diagrams.js` in every template**

```bash
for t in blackboard engineer-grid legal-pad margin-qa spiral-notes sticky-wall studygram-pastel terminal-dark; do
  sed -i 's|<script src="../_shared/layout.js"></script>|<script src="../_shared/layout.js"></script>\n<script src="../_shared/diagrams.js"></script>|' templates/$t/template.html
  grep -q 'diagrams.js' templates/$t/template.html || echo "MISSING in $t"
done
```

If a template loads scripts in a different order, insert the tag anywhere after `pack.js` and before the inline bootstrap script.

- [ ] **Step 5: Create `templates/_shared/diagrams.js`**

```js
// Flowchart edges: orthogonal arrows drawn over the placed nodes, after layout, before jitter.
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function center(rect, box) {
    return { x: rect.left - box.left + rect.width / 2, top: rect.top - box.top, bottom: rect.bottom - box.top };
  }

  function labelColor(label) {
    var l = (label || '').toLowerCase();
    if (l === 'yes' || l === 'true') return 'var(--ink-green)';
    if (l === 'no' || l === 'false') return 'var(--ink-red)';
    return 'var(--ink-black)';
  }

  window.drawFlowchartEdges = function (root) {
    var charts = (root || document).querySelectorAll('.dg-flowchart');
    charts.forEach(function (chart) {
      var svg = chart.querySelector('svg.fc-edges');
      if (!svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var box = chart.getBoundingClientRect();
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);

      var defs = document.createElementNS(NS, 'defs');
      var marker = document.createElementNS(NS, 'marker');
      marker.setAttribute('id', 'fc-arrow-' + Math.random().toString(36).slice(2, 8));
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto-start-reverse');
      var head = document.createElementNS(NS, 'path');
      head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      head.setAttribute('fill', 'var(--ink-black)');
      marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);

      var edges = [];
      try { edges = JSON.parse(chart.getAttribute('data-edges') || '[]'); } catch (e) { edges = []; }
      var nodes = {};
      chart.querySelectorAll('.fc-node').forEach(function (n) { nodes[n.getAttribute('data-id')] = center(n.getBoundingClientRect(), box); });

      edges.forEach(function (edge) {
        var a = nodes[edge.from], b = nodes[edge.to];
        if (!a || !b) return;
        var down = b.top >= a.bottom;
        var x1 = a.x, y1 = down ? a.bottom : a.top;
        var x2 = b.x, y2 = down ? b.top : b.bottom;
        var points, lx, ly;
        if (Math.abs(x1 - x2) < 4) {
          points = [[x1, y1], [x2, y2]];
          lx = x1 + 6; ly = (y1 + y2) / 2;
        } else {
          var ym = (y1 + y2) / 2;
          points = [[x1, y1], [x1, ym], [x2, ym], [x2, y2]];
          lx = (x1 + x2) / 2; ly = ym - 4;
        }
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--ink-black)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('marker-end', 'url(#' + marker.getAttribute('id') + ')');
        svg.appendChild(path);
        if (edge.label) {
          var text = document.createElementNS(NS, 'text');
          text.setAttribute('x', lx); text.setAttribute('y', ly);
          text.setAttribute('class', 'fc-label');
          text.setAttribute('fill', labelColor(edge.label));
          text.textContent = edge.label;
          svg.appendChild(text);
        }
      });
    });
  };
})();
```

- [ ] **Step 6: Call it from `layout.js`**

In `templates/_shared/layout.js`, immediately before `window.LAYOUT = {` (line ~115) insert:

```js
    if (window.drawFlowchartEdges) window.drawFlowchartEdges(document);
```

- [ ] **Step 7: Extend `jitter.js`**

Replace the `[data-jitter]` walker's TreeWalker creation so highlighted text is atomic:

```js
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.hl') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
```

After the `[data-jitter]` block and before the `[data-rough]` block, add sticky rotation (draws from the same RNG, so pages without stickies keep their pixels):

```js
  document.querySelectorAll('.co-sticky').forEach((el) => {
    el.style.transform = 'rotate(' + ((r() * 2 - 1) * 2).toFixed(2) + 'deg)';
  });
```

Replace the rough frame drawing (`svg.appendChild(rc.rectangle(...))`) with shape-aware drawing:

```js
    const opts = {
      stroke: el.dataset.rough || '#333',
      strokeWidth: 2.2,
      roughness: 1.6,
      bowing: 1.2,
      fill: 'none',
    };
    if (el.dataset.roughDash) opts.strokeLineDash = [9, 7];
    const w = rect.width + 4, h = rect.height + 4;
    const shape = el.dataset.roughShape || 'box';
    if (shape === 'diamond') {
      svg.appendChild(rc.polygon([[2 + w / 2, 2], [2 + w, 2 + h / 2], [2 + w / 2, 2 + h], [2, 2 + h / 2]], opts));
    } else if (shape === 'pill') {
      const rr = h / 2;
      svg.appendChild(rc.path(
        'M ' + (2 + rr) + ' 2 H ' + (2 + w - rr) + ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (2 + w - rr) + ' ' + (2 + h) +
        ' H ' + (2 + rr) + ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (2 + rr) + ' 2 Z', opts));
    } else {
      svg.appendChild(rc.rectangle(2, 2, w, h, opts));
    }
```

- [ ] **Step 8: Append the shared styles to `base.css`**

```css
/* ── inline markup ── */
:root{--ink-purple:var(--ink-blue);--ink-orange:var(--ink-red);--hl:#fff176;--sticky:#fff59d;--sticky-pink:#f8bbd0;--table-head:transparent;--rule:#445}
.hl{background:linear-gradient(transparent 12%,var(--hl) 12%,var(--hl) 88%,transparent 88%);padding:0 .15em;border-radius:2px;color:inherit}
.em{color:var(--ink-red);font-weight:700}
.ul{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.15em}
.mono{font-family:'JetBrains Mono',monospace;font-size:.92em}
.ink-purple{color:var(--ink-purple)}
.ink-orange{color:var(--ink-orange)}

/* ── list styles ── */
.b-bullets.bl-number li::before,.b-bullets.bl-check li::before,.b-bullets.bl-cross li::before{content:""}
.b-bullets.bl-number .bl-glyph{color:var(--ink-blue);margin-right:.45em;font-weight:700}
.b-bullets.bl-check li::before{content:"✓ ";color:var(--ink-green);font-weight:700}
.b-bullets.bl-cross li::before{content:"✗ ";color:var(--ink-red);font-weight:700}

/* ── frames ── */
.b-frame{padding:.5vh 1.1vw;margin:.4vh 0;background:var(--paper,transparent);border-radius:5px}
.b-frame>.b-bullets,.b-frame>.b-paragraph,.b-frame>.b-table{margin:0}

/* ── tables ── */
.b-table th{background:var(--table-head)}
.b-table th,.b-table td{border-color:var(--rule);border-width:1.5px}
.b-table tr.hl-row td{background:var(--hl)}

/* ── sticky notes ── */
.b-callout.co-sticky{background:var(--sticky);border-radius:2px;box-shadow:2px 3px 6px rgba(0,0,0,.18);padding:.9vh 1.2vw .6vh;position:relative;max-width:100%}
.b-callout.co-sticky.co-sticky-pink,.code-note.co-sticky-pink{background:var(--sticky-pink)}
.co-pin{position:absolute;top:-1.1vh;left:50%;transform:translateX(-50%);font-size:1.6vh;line-height:1}
.b-callout.co-sticky .co-title{color:var(--ink-black);text-decoration:none;font-weight:700}
.b-callout.co-sticky .co-text{color:var(--ink-black)}

/* ── code ── */
.b-code{position:relative;white-space:pre;overflow:hidden}
.b-code pre{margin:0;font:inherit;white-space:pre;tab-size:4}
.b-code.code-small{font-size:1.15vh}
.b-code.has-note{padding-right:calc(1vw + 22%)}
.code-note{position:absolute;top:.6vh;right:.8vw;width:20%;font-family:'Kalam',cursive;font-size:1.25vh;line-height:1.35;color:var(--ink-black);background:var(--sticky);padding:1vh .6vw .5vh;box-shadow:2px 3px 6px rgba(0,0,0,.18);white-space:normal;text-align:center}
.tk-kw{color:var(--ink-purple);font-weight:700}
.tk-cm{color:var(--ink-green)}
.tk-str{color:var(--ink-red)}
.tk-num{color:var(--ink-orange)}
.tk-fn{color:var(--ink-blue)}
#page.code-hand .b-code{font-family:'Patrick Hand',cursive;letter-spacing:.02em;font-size:1.5vh}
#page.code-hand .b-code.code-small{font-size:1.28vh}

/* ── rich flow nodes ── */
.dg-node-rich{display:inline-block;text-align:center;padding:.5vh 1vw}
.dg-node-rich .dg-title{font-weight:700}
.dg-node-rich .dg-sub{font-size:.85em;color:var(--ink-black);opacity:.85}

/* ── array ── */
.dg-array{display:flex;align-items:flex-start;gap:1.2vw}
.ar-grid{display:grid;grid-template-columns:repeat(var(--ar-cols,1),minmax(2.6vw,4.2vw));column-gap:.35vw;row-gap:.3vh;align-items:end}
.ar-idx{font-size:1.2vh;color:var(--ink-blue);text-align:center}
.ar-cell{font-size:1.5vh;color:var(--ink-black);text-align:center;padding:.45vh 0;background:var(--paper,transparent)}
.ar-cell.ar-hl{background:var(--hl)}
.ar-cell.ar-dim{color:#999}
.ar-ptr{font-size:1.2vh;text-align:center;line-height:1.15;min-height:1.2vh}
.ar-ptr-arrow{font-size:1.5vh;line-height:1}
.ar-caption{font-size:1.35vh;padding:.5vh .9vw;color:var(--ink-black);background:var(--paper,transparent);align-self:center}

/* ── flowchart ── */
.dg-flowchart{position:relative;display:flex;flex-direction:column;gap:2.2vh;padding:.4vh 0}
.fc-row{display:flex;justify-content:space-evenly;align-items:center;gap:2vw}
.fc-node{font-size:1.4vh;color:var(--ink-black);background:var(--paper,transparent);padding:.5vh 1.2vw;text-align:center;min-width:8vw;max-width:26vw}
.fc-node.fc-diamond{padding:1.6vh 2.2vw}
.fc-node.fc-pill{padding:.45vh 1.6vw}
.fc-edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1}
.fc-label{font-family:'Caveat',cursive;font-size:1.5vh;font-weight:700}

/* ── matrix ── */
.dg-matrix{display:flex;align-items:center;gap:1.2vw}
.mx{border-collapse:collapse;background:var(--paper,transparent)}
.mx td{border:1.5px solid var(--rule);padding:.35vh .9vw;text-align:center;font-size:1.45vh;color:var(--ink-black);min-width:3vw}
.mx td.mx-hl{background:var(--hl)}
.mx-caption{font-size:1.35vh;color:var(--ink-black)}

/* ── cards ── */
.dg-cards{display:grid;grid-template-columns:repeat(var(--card-cols,3),1fr);gap:1.2vw;align-items:start}
.card{padding:.5vh 1vw;background:var(--paper,transparent)}
.card-title{font-family:'Caveat',cursive;font-size:1.7vh;font-weight:700;text-decoration:underline;margin-bottom:.2vh}
.card li{font-size:1.35vh;color:var(--ink-black);line-height:1.4;list-style:none}
.card li::before{content:"• "}
```

- [ ] **Step 9: Run the contract tests**

Run: `npx vitest run tests/templates.test.ts -t "has required markers|shared assets|base.css"`
Expected: PASS for these three. The "every schema template" test stays red until Task 8.

- [ ] **Step 10: Commit**

```bash
git add templates/_shared/base.css templates/_shared/jitter.js templates/_shared/diagrams.js templates/_shared/layout.js templates/*/template.html templates/*/manifest.json tests/templates.test.ts tests/flowchart.edges.test.ts
git commit -m "feat(templates): shared styles for markup, frames, stickies, code, diagrams; rough shapes; flowchart edges"
```

---

### Task 8: `study-sheet` family

**Files:**
- Create: `templates/study-sheet/template.html`, `templates/study-sheet/manifest.json`
- Test: `tests/templates.test.ts` (Task 7's first assertion), `tests/render.e2e.test.ts` (Task 10 adds it to the family list)

**Interfaces:**
- Consumes: `PAGE` vars from `page.ts`, shared scripts, class names from Tasks 5-7.

- [ ] **Step 1: Create `templates/study-sheet/manifest.json`**

```json
{
  "name": "study-sheet",
  "displayName": "Study Sheet",
  "inks": {
    "blue": "#2b4ea8",
    "red": "#c62828",
    "green": "#2e7d32",
    "black": "#222222",
    "accent": "#c62828",
    "purple": "#5b3fa0",
    "orange": "#d97706"
  },
  "supports": ["heading", "paragraph", "bullets", "sidebox", "table", "code", "diagram", "callout", "qa"],
  "contentSelector": "#content",
  "maxColumns": 2,
  "columnGap": "2.4vw",
  "defaults": { "frame": "dashed" },
  "codeFont": "hand"
}
```

- [ ] **Step 2: Create `templates/study-sheet/template.html`**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<!--HEAD-->
<style>
:root{--ink-blue:#2b4ea8;--ink-red:#c62828;--ink-green:#2e7d32;--ink-black:#222;--ink-accent:#c62828;--ink-purple:#5b3fa0;--ink-orange:#d97706;
  --paper:#fdfcf7;--table-head:#e8f3e8;--rule:#8a8a8a;--hl:#fff176}
body{font-family:'Patrick Hand',cursive;background:#e9e6dd}
#page{background:var(--paper);padding:2.2vh 3.2vw 2.2vh}
.head{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;gap:1vw}
.head .brand{font-size:2vh;color:var(--ink-black);text-decoration:underline double var(--ink-blue) 2px;text-underline-offset:.4vh;white-space:nowrap}
.head .series{font-family:'Architects Daughter',cursive;font-size:2.2vh;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-black);padding:.3vh 1.6vw;white-space:nowrap}
.head .badge{font-family:'Patrick Hand',cursive;font-size:1.9vh;color:var(--ink-black);padding:.2vh 1.2vw;white-space:nowrap}
.title{font-family:'Architects Daughter',cursive;font-size:3.6vh;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-black);text-align:center;margin:1vh 0 1.4vh;position:relative;z-index:1;line-height:1.15}
.title .rule{position:absolute;left:8%;right:8%;bottom:-.5vh;height:.6vh;pointer-events:none}

/* ── blocks ── */
.b-heading{font-family:'Architects Daughter',cursive;font-size:2.05vh;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-purple);margin:1vh 0 .35vh}
.b-heading::before{content:"☆ ";color:var(--ink-purple)}
.b-paragraph{font-size:1.55vh;color:var(--ink-black);line-height:1.7;margin:.3vh 0}
.b-bullets{margin:.3vh 0 .3vh 1vw}
.b-bullets li{font-size:1.52vh;color:var(--ink-black);line-height:1.7;list-style:none}
.b-bullets li::before{content:"• ";color:var(--ink-blue)}
.b-sidebox{border-radius:6px;padding:.6vh 1.2vw;margin:.6vh 0;background:var(--paper)}
.b-sidebox .sb-title{font-family:'Architects Daughter',cursive;font-size:1.7vh;color:var(--ink-green);text-decoration:underline;margin-bottom:.2vh}
.b-sidebox li{font-size:1.45vh;color:var(--ink-black);line-height:1.6;margin-left:1vw;list-style:none}
.b-sidebox li::before{content:"• "}
.b-table{width:100%;border-collapse:collapse;font-size:1.38vh;background:var(--paper);margin:.6vh 0}
.b-table th{font-family:'Architects Daughter',cursive;font-size:1.45vh;color:var(--ink-black);text-decoration:underline}
.b-table th,.b-table td{padding:.3vh .8vw;text-align:center;color:var(--ink-black)}
.b-code{color:var(--ink-black);background:var(--paper);border:2px solid var(--ink-purple);border-radius:8px;padding:.7vh 1.2vw;margin:.6vh 0;line-height:1.55}
.b-callout{border-radius:6px;padding:.6vh 1.2vw;margin:.6vh 0;background:var(--paper)}
.b-callout .co-title{font-family:'Architects Daughter',cursive;font-size:1.65vh;text-decoration:underline}
.b-callout.co-tip .co-title,.b-callout.co-takeaway .co-title{color:var(--ink-red)}
.b-callout.co-cloud{border-radius:50px;text-align:center}
.b-callout.co-cloud .co-title{color:var(--ink-green)}
.b-callout .co-text{font-size:1.45vh;color:var(--ink-black);line-height:1.6}
.b-qa .qa-q{font-size:1.65vh;color:var(--ink-red);font-weight:700;margin:.8vh 0 .2vh}
.b-qa .qa-ans-label{color:var(--ink-red);font-weight:700;text-decoration:underline double}
.b-qa .qa-a li{font-size:1.5vh;color:var(--ink-blue);line-height:1.65;margin-left:2vw;list-style:none}
.b-qa .qa-a li::before{content:"• "}
.b-diagram{margin:.6vh 0}
.b-diagram .dg-flow{display:flex;align-items:center;gap:.8vw;flex-wrap:wrap;font-size:1.4vh;color:var(--ink-black)}
.b-diagram .dg-node{background:var(--paper);padding:.4vh 1vw}
.b-diagram .dg-arrow{color:var(--ink-black);font-weight:700;font-size:1.8vh}
.b-frame{background:var(--paper)}
.vignette{background:radial-gradient(ellipse at center,transparent 72%,rgba(0,0,0,.06) 100%)}
</style>
</head>
<body>
<div id="page">
  <div class="head">
    <span class="brand" id="v-brand"></span>
    <span class="series" id="v-series" data-rough="var(--ink-green)" data-rough-shape="pill" data-jitter></span>
    <span class="badge" id="v-badge" data-rough="var(--ink-red)" data-jitter></span>
  </div>
  <div class="title" id="v-title" data-jitter><span id="v-title-text"></span><svg class="rule" id="v-rule"></svg></div>
  <div id="content"><!--CONTENT--></div>
  <div class="paper-texture"></div>
  <div class="vignette"></div>
</div>
<script src="../_shared/rough.min.js"></script>
<script src="../_shared/pack.js"></script>
<script src="../_shared/layout.js"></script>
<script src="../_shared/diagrams.js"></script>
<script src="../_shared/jitter.js"></script>
<!--PAGEVARS-->
<script>
  document.getElementById('v-brand').textContent = '@' + PAGE.brand;
  document.getElementById('v-series').textContent = PAGE.series;
  document.getElementById('v-badge').textContent = 'Page ' + PAGE.pageNum;
  document.getElementById('v-title-text').textContent = PAGE.pageNum + '. ' + PAGE.page_title;
  document.fonts.ready.then(function () {
    applyLayout({ columns: PAGE.columns, rowGapPx: PAGE.rowGapPx });
    applyJitter(PAGE.seed + PAGE.pageNum);
    // Hand-drawn red underline under the title, drawn after jitter so its width is final.
    var svg = document.getElementById('v-rule');
    var w = svg.getBoundingClientRect().width;
    var rc = rough.svg(svg, { options: { seed: PAGE.seed + PAGE.pageNum } });
    svg.setAttribute('viewBox', '0 0 ' + w + ' 8');
    svg.appendChild(rc.line(0, 4, w, 4, { stroke: 'var(--ink-red)', strokeWidth: 2.6, roughness: 1.4, bowing: 1.5 }));
  });
</script>
</body>
</html>
```

- [ ] **Step 3: Run the template tests**

Run: `npx vitest run tests/templates.test.ts`
Expected: PASS, all assertions including "every schema template has a directory".

- [ ] **Step 4: Render one smoke slide to look at it**

```bash
node -e '
const { renderSlide, closeBrowser } = require("./lib/renderer/capture");
' 2>/dev/null || true
npx tsx -e "
import { renderSlide, closeBrowser } from './lib/renderer/capture';
import { validatePost } from './lib/schema';
const post = validatePost({ brand: 'iolar', template: 'study-sheet', ratio: '3:4', seed: 3, series: 'BINARY SEARCH PATTERNS', date: '', slides: [{ page_title: 'Binary Search Fundamentals', blocks: [
  { type: 'heading', text: '1. What is Binary Search?' },
  { type: 'paragraph', text: 'Finds a target in a ==sorted array== by halving the search space.' },
  { type: 'heading', text: '2. Prerequisites' },
  { type: 'bullets', style: 'check', items: ['Array must be ==sorted==', 'Random access to elements'], frame: 'dashed', ink: 'green' },
  { type: 'heading', text: '3. Mid calculation' },
  { type: 'code', lang: 'java', lines: ['int mid = low + (high - low) / 2;'], note: 'avoids overflow' },
  { type: 'diagram', kind: 'array', spec: { cells: ['2','5','8','12','16','23','38'], pointers: [{ index: 0, label: 'low' }, { index: 3, label: 'mid', ink: 'red' }, { index: 6, label: 'high' }], highlight: [3], caption: 'arr[mid] = 12 < 16 → go **right**' } },
  { type: 'callout', style: 'sticky', title: 'Why?', text: 'low + high can overflow' },
]}], caption: { text: '', hashtags: [] } });
const r = await renderSlide(post, 0, process.env.TEMP + '/study-sheet-smoke.png');
console.log(r); await closeBrowser();
"
```

Open `%TEMP%\study-sheet-smoke.png` (Read tool) and check: pill series badge, red page badge, big title with red underline, ☆ purple headings, dashed frames, hand-font code with the sticky, array with pointers. Fix CSS sizes if anything overlaps; overflowPx must be 0.

- [ ] **Step 5: Commit**

```bash
git add templates/study-sheet
git commit -m "feat(templates): study-sheet family cloned from the reference chrome"
```

---

### Task 9: Planner rules, editor option lists

**Files:**
- Modify: `lib/ai/plan.ts:11-53` (export and extend `SCHEMA_RULES`), `lib/ai/plan.ts:115-128` (recipe guidance)
- Modify: `components/editor/BlockForm.tsx:10-12`
- Test: `tests/plan.rules.test.ts` (create)

**Interfaces:**
- Produces: `export const SCHEMA_RULES: string` from `lib/ai/plan.ts`; `export const RECIPE_GUIDANCE: string`.

- [ ] **Step 1: Write the failing test**

Create `tests/plan.rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from '@/lib/ai/plan';
import { DIAGRAM_KINDS, BULLET_STYLES, TEMPLATES } from '@/lib/schema';

describe('SCHEMA_RULES teaches the whole vocabulary', () => {
  it('names every diagram kind, list style and template', () => {
    for (const k of DIAGRAM_KINDS) expect(SCHEMA_RULES).toContain(`"${k}"`);
    for (const s of BULLET_STYLES) expect(SCHEMA_RULES).toContain(`"${s}"`);
    for (const t of TEMPLATES) expect(SCHEMA_RULES).toContain(`"${t}"`);
  });
  it('names every inline marker and the new fields', () => {
    for (const m of ['==', '**', '__', '`', '{green:']) expect(SCHEMA_RULES).toContain(m);
    for (const f of ['"frame"', '"note"', '"highlightRow"', '"sticky"', '"sticky-pink"', '"purple"', '"orange"']) expect(SCHEMA_RULES).toContain(f);
  });
  it('states the code line ceiling that keeps a snippet in a column', () => {
    expect(SCHEMA_RULES).toMatch(/34 characters/);
  });
  it('no longer offers removed diagram kinds', () => {
    for (const k of ['memory-cells', '"tree"', '"compare"']) expect(SCHEMA_RULES).not.toContain(k);
  });
  it('recipe guidance covers the pattern page and the revision sheet', () => {
    for (const w of ['dry run', 'revision sheet', 'flowchart', 'complexity']) expect(RECIPE_GUIDANCE.toLowerCase()).toContain(w);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/plan.rules.test.ts`
Expected: FAIL — `SCHEMA_RULES` not exported.

- [ ] **Step 3: Rewrite `SCHEMA_RULES` and add `RECIPE_GUIDANCE` in `lib/ai/plan.ts`**

```ts
import { Post, validatePost, MAX_SLIDES, TEMPLATES } from '../schema';

export const SCHEMA_RULES = `Return ONLY a complete post JSON object (no prose, no markdown fences) with this exact shape:
{
  "brand": string, "template": one of [${TEMPLATES.map((t) => `"${t}"`).join(',')}],
  "ratio": "3:4", "seed": integer,
  "series": string (short series title, uppercase),
  "date": string (DD/MM/YYYY),
  "slides": [ { "page_title": string, "blocks": [Block, ...] }, ... ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Ink = "blue"|"red"|"green"|"black"|"accent"|"purple"|"orange". Frame = "none"|"solid"|"dashed".
Block types (discriminated by "type"):
- {"type":"heading","text":string,"ink"?:Ink}
- {"type":"paragraph","text":string,"frame"?:Frame,"ink"?:Ink}
- {"type":"bullets","items":[string,...],"style"?:"dot"|"number"|"check"|"cross","frame"?:Frame,"ink"?:Ink}
- {"type":"sidebox","title":string,"items":[string,...],"ink"?:Ink}
- {"type":"table","headers":[string,...],"rows":[[string,...],...],"highlightRow"?:integer,"frame"?:Frame}
- {"type":"code","lang":string,"lines":[string,...],"note"?:string}
- {"type":"callout","style":"tip"|"takeaway"|"cloud"|"sticky"|"sticky-pink","title":string,"text":string}
- {"type":"qa","q":string,"a_bullets":[string,...],"example_code"?:[string,...]}
- {"type":"diagram","kind":"flow","spec":{"nodes":[string | {"text":string,"sub"?:string,"ink"?:Ink},...]}}
- {"type":"diagram","kind":"array","spec":{"cells":[string,...],"indices"?:boolean,"pointers"?:[{"index":integer,"label":string,"ink"?:Ink}],"highlight"?:[integer],"dim"?:[integer],"caption"?:string}}
- {"type":"diagram","kind":"flowchart","spec":{"rows":[[nodeId,...],...],"nodes":{nodeId:{"text":string,"shape"?:"box"|"diamond"|"pill","ink"?:Ink}},"edges":[{"from":nodeId,"to":nodeId,"label"?:string}]}}
  rows are top to bottom, 1-3 node ids per row, 2-7 rows; every edge endpoint must appear in rows.
- {"type":"diagram","kind":"matrix","spec":{"rows":[[string,...],...],"highlight"?:[[row,col],...],"caption"?:string}}
- {"type":"diagram","kind":"cards","spec":{"cards":[{"title":string,"lines":[string,...],"ink"?:Ink},...]}} (2-4 cards)

INLINE MARKUP inside any text, item, cell or label (not in headings or code lines):
==term== yellow highlighter, **word** red emphasis, __word__ underline, \`x\` monospace, {green:word} / {blue:…} / {red:…} / {purple:…} / {orange:…} coloured ink.
Use them the way a student does: highlight 1-3 key terms per block, put **…** on the one decisive word
(RIGHT, LEFT, sorted), underline the answer in a dry run. Never mark up whole sentences.

VOCABULARY RULES:
- "style":"number" for procedures and algorithm steps; "check" for prerequisites and "when to use"; "cross" for mistakes and anti-patterns.
- "frame":"dashed" boxes a section body; give the box an "ink" that matches its meaning (green definition, red mistakes, blue complexity, purple template).
- "note" on code: the one gotcha next to the snippet, at most 8 words ("works only on SORTED arrays").
- "sticky" callouts for a pinned aside; "tip" and "takeaway" stay for boxed advice.
- "array" wherever indices or pointers are walked (low / mid / high); "flowchart" for any decision procedure; "cards" for an end-of-page summary strip; "matrix" for 2-D data; "flow" for a left-to-right pipeline.
- Dry runs are tables shaped Step | low | high | mid | arr[mid] | action, with "highlightRow" on the answer row.
- Code lines at most 34 characters so a snippet can sit inside a column; a longer line forces the block full width and a line over 80 is cut.

"page_title" is the section name ONLY — never write "Page 3:" or a page number in it; the template adds that.

WRITE SHORT BLOCKS, MANY OF THEM. This is the single most important rule. Real study-notes
pages are dense because they carry MANY SMALL items, not a few long ones. A page is a
TWO-COLUMN grid holding about 70 short lines, and short blocks pair up side by side.

Per-block ceilings — treat these as hard:
- bullets: 3-5 items, each ONE line (max 12 words). Never a paragraph inside a bullet.
- paragraph: at most 2 short sentences. Prefer bullets; use paragraph sparingly.
- table: 3-5 rows, 2-4 columns, cells of 1-3 words. Terse ("O(1) avg", not "on average constant time").
- code: 3-6 lines, each under 34 characters, with a short trailing comment where it teaches something.
- sidebox / callout: title plus 2-4 one-line items.
- heading: a 2-5 word section label; number them (1., 2., 3. ...).
- array: at most 12 cells; flowchart: at most 12 nodes; cards: 2-4 cards of 2-3 lines.

Each block should render in about 4-6 lines. A block that runs past ~8 lines is too long —
split it into two blocks or cut words.

PER-SLIDE TARGET: 12-16 blocks, i.e. 4-6 numbered sections each followed by its bullets,
table, code or diagram. Fewer than 10 blocks means the page will render half empty.

SLIDE COUNT: exactly ${MAX_SLIDES} slides unless the book truly cannot fit. Divide the book's
points evenly — with N points that is about N/${MAX_SLIDES} points per slide, and each point
should become one short bullet, one table row, or one code line, NOT a paragraph.`;

export const RECIPE_GUIDANCE = `If the subject is an algorithm or coding pattern family, shape it the way an interview study sheet is shaped:
every pattern page carries, in order, a definition ("what is it"), the template code with a "note", a condition/action
table, a dry run table with the answer row highlighted, a visual walkthrough ("array" diagram with low/mid/high pointers),
and a "cross" list of common mistakes. The LAST slide is a revision sheet: a numbered list of the most-asked questions, a
decision "flowchart", a quick-reference table (pattern | goal | key update | return), a complexity table, and a "check"
list of when to use it. For other subjects, keep the same spirit: definition, mechanism, example, mistakes, summary.`;
```

In `planSlidesFromBook` (plan.ts ~line 115-128) add `RECIPE_GUIDANCE,` as one more element of the prompt parts array, after the `'Write original prose — …'` line.

- [ ] **Step 4: Update the editor option lists in `components/editor/BlockForm.tsx`**

```ts
import { INKS, DIAGRAM_KINDS } from '@/lib/schema';

const INK_OPTS = INKS.map((v) => ({ value: v }));
const CALLOUT_OPTS = ['tip', 'takeaway', 'cloud', 'sticky', 'sticky-pink'].map((v) => ({ value: v }));
const DIAGRAM_OPTS = DIAGRAM_KINDS.map((v) => ({ value: v }));
```

Update the diagram textarea placeholder to `'{"nodes": ["a", "b"]}  |  array: {"cells": [...], "pointers": [...]}'`.

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run tests/plan.rules.test.ts tests/reel.plan.test.ts tests/research.plan.test.ts && npx tsc --noEmit -p . && npx eslint lib/ai/plan.ts components/editor/BlockForm.tsx`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/plan.ts components/editor/BlockForm.tsx tests/plan.rules.test.ts
git commit -m "feat(planner): teach the model inline markup, list styles, frames, notes and the five diagram kinds"
```

---

### Task 10: Render e2e — every new block on two families, contact sheet, flowchart edges

**Files:**
- Modify: `tests/render.e2e.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add the e2e tests**

Append to `tests/render.e2e.test.ts`:

```ts
function kitchenSink(template: string): Post {
  return validatePost({
    brand: 'iolar', template, ratio: '3:4', seed: 11,
    series: 'BINARY SEARCH PATTERNS', date: '06/09/2026',
    slides: [{
      page_title: 'Every New Block', blocks: [
        { type: 'heading', text: '1. What is it?' },
        { type: 'paragraph', text: 'Finds a target in a ==sorted array== by __halving__ the space.', frame: 'dashed', ink: 'green' },
        { type: 'heading', text: '2. Steps' },
        { type: 'bullets', style: 'number', items: ['Start with the whole array', 'Find the middle', 'Go **left** or **right**'] },
        { type: 'heading', text: '3. Mistakes' },
        { type: 'bullets', style: 'cross', items: ['`(low + high) / 2` overflows', 'Using `<` in the loop'], frame: 'solid', ink: 'red' },
        { type: 'code', lang: 'java', lines: ['int mid = low + (high - low) / 2;', 'if (arr[mid] == target) return mid;'], note: 'sorted only' },
        { type: 'diagram', kind: 'array', spec: { cells: ['2', '5', '8', '12', '16', '23', '38'], pointers: [{ index: 0, label: 'low' }, { index: 3, label: 'mid', ink: 'red' }, { index: 6, label: 'high' }], highlight: [3], dim: [0, 1], caption: '12 < 16 → right' } },
        { type: 'table', headers: ['Step', 'low', 'high', 'mid', 'action'], rows: [['1', '0', '8', '4', 'right'], ['2', '5', '8', '6', 'left'], ['3', '5', '5', '5', 'found']], highlightRow: 2 },
        { type: 'diagram', kind: 'flowchart', spec: {
          rows: [['s'], ['m'], ['d'], ['l', 'r'], ['e']],
          nodes: { s: { text: 'Start', shape: 'pill' }, m: { text: 'mid = low + (high-low)/2' }, d: { text: 'arr[mid] == target?', shape: 'diamond' }, l: { text: 'Search left', ink: 'blue' }, r: { text: 'Search right', ink: 'blue' }, e: { text: 'Not found', ink: 'red' } },
          edges: [{ from: 's', to: 'm' }, { from: 'm', to: 'd' }, { from: 'd', to: 'l', label: 'no' }, { from: 'd', to: 'r', label: 'no' }, { from: 'l', to: 'e' }, { from: 'r', to: 'e' }],
        } },
        { type: 'callout', style: 'sticky', title: 'Key idea', text: 'One half is always sorted' },
        { type: 'diagram', kind: 'matrix', spec: { rows: [['1', '3', '5'], ['10', '11', '16']], highlight: [[1, 2]], caption: 'n = 3' } },
        { type: 'diagram', kind: 'flow', spec: { nodes: [{ text: 'Define', sub: 'answer', ink: 'red' }, { text: 'Search space', ink: 'orange' }, { text: 'isPossible', ink: 'blue' }] } },
        { type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'Find target', lines: ['compare arr[low] & arr[mid]'] }, { title: 'Find pivot', lines: ['compare arr[mid] & arr[high]'], ink: 'orange' }, { title: 'Duplicates', lines: ['low++, high--'], ink: 'purple' }] } },
      ],
    }],
    caption: { text: '', hashtags: [] },
  });
}

describe('new blocks render', () => {
  it.each(['study-sheet', 'spiral-notes'])('%s renders every new block on one page with no overflow', async (template) => {
    const out = path.join(tmpdir(), `iolar-sink-${template}.png`);
    const r = await renderSlide(kitchenSink(template), 0, out);
    expect(existsSync(out)).toBe(true);
    expect(r.overflowPx).toBe(0);
    expect(r.warnings).toEqual([]);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1440]);
  }, 90_000);

  it('reports a truncated code line as a warning', async () => {
    const post = kitchenSink('spiral-notes');
    post.slides[0].blocks = [{ type: 'code', lang: 'python', lines: ['x'.repeat(95)] }];
    const r = await renderSlide(post, 0, path.join(tmpdir(), 'iolar-warn.png'));
    expect(r.warnings).toEqual(['block 0: code line 1 truncated at 80 chars']);
  }, 90_000);

  it('writes a contact sheet of the kitchen sink across every family', async () => {
    const { TEMPLATES } = await import('@/lib/schema');
    const tiles: Buffer[] = [];
    for (const template of TEMPLATES) {
      const out = path.join(tmpdir(), `iolar-sink-${template}.png`);
      const r = await renderSlide(kitchenSink(template), 0, out);
      expect(r.overflowPx, template).toBe(0);
      tiles.push(await sharp(out).resize(360, 480).png().toBuffer());
    }
    const cols = 3, rows = Math.ceil(tiles.length / cols);
    const sheet = path.join(tmpdir(), 'iolar-blocks-contact.png');
    await sharp({ create: { width: cols * 360, height: rows * 480, channels: 3, background: '#ffffff' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 360, top: Math.floor(i / cols) * 480 })))
      .png().toFile(sheet);
    expect(existsSync(sheet)).toBe(true);
    console.log('contact sheet:', sheet);
  }, 600_000);
});
```

Also update the existing `it.each([...])` family list in `describe('renderSlide')` to include `'study-sheet'`.

- [ ] **Step 2: Run the render e2e suite**

Run: `npx vitest run tests/render.e2e.test.ts`
Expected: PASS. If a family overflows on the kitchen sink, the fix is CSS density in `base.css` for that block (smaller `.fc-node` padding or `.ar-cell` font), never a change to the test content. If `fc-edges` paths are missing on inspection, check the script order in that template (diagrams.js must load before the inline bootstrap).

- [ ] **Step 3: Eyeball the contact sheet**

Read `%TEMP%\iolar-blocks-contact.png` and `%TEMP%\iolar-sink-study-sheet.png` with the Read tool. Check: highlight visible, circled numbers, ✗ list in a red frame, hand code with a sticky, array pointers under the right cells, flowchart arrows reach the boxes with labels, matrix highlight, three cards in a row. Adjust `base.css` sizes if something overlaps and re-run Step 2.

- [ ] **Step 4: Run the whole suite once**

Run: `npx vitest run --maxWorkers=2 && npx tsc --noEmit -p . && npx eslint lib templates/_shared components/editor tests --ext .ts,.tsx,.js`
Expected: all green (the box needs `--maxWorkers=2`). If `eslint` rejects the browser scripts, run it on `lib components tests` only; `templates/_shared` is plain browser JS.

- [ ] **Step 5: Commit**

```bash
git add tests/render.e2e.test.ts templates/_shared/base.css
git commit -m "test(render): every new block on every family, warnings, contact sheet"
```

---

### Task 11: Prove it on a real handbook

**Files:**
- No source changes expected; `data/handbooks/**` is gitignored runtime data.

- [ ] **Step 1: Re-render one stored part on study-sheet**

```bash
npx tsx -e "
import { loadPost, savePost } from './lib/store';
import { renderAll } from './lib/renderer/capture';
import { rendersDir } from './lib/paths';
const post = await loadPost('security', 'injection', 1);
post.template = 'study-sheet';
const { results } = await renderAll(post, rendersDir('security', 'injection', 1) + '-study-sheet');
console.table(results.map(r => ({ slide: r.slide, fill: r.fillPct, overflow: r.overflowPx, warnings: r.warnings.length })));
"
```

Look at two of the output PNGs with the Read tool. Expect: overflow 0 everywhere, code blocks no longer wrapped (they went full width where needed), dashed frames on every bullets block from the manifest default. No stored post is modified: the output goes to a sibling directory.

- [ ] **Step 2: Plan one fresh part with the local provider to see the planner use the vocabulary**

Only if the studio is running and the provider is `local` (Ollama on 11434 with `qwen3.8:27b`, see `_devkit/PORTMAP.md`): use the studio UI or `POST /api/handbooks/<subject>/<chapter>/parts/<n>/plan` on a small algorithm topic ("binary search patterns") and inspect the resulting `post.json` for `==…==`, `"style":"number"`, `"kind":"array"`. If the model ignores the vocabulary, strengthen the VOCABULARY RULES wording in `SCHEMA_RULES` (Task 9) with one example block and re-run `tests/plan.rules.test.ts`.

- [ ] **Step 3: Clean up**

```bash
rm -rf "$(node -e "process.stdout.write(require('./lib/paths').rendersDir('security','injection',1)+'-study-sheet')")"
git status --short   # expect: clean
```

- [ ] **Step 4: Hand off**

Report to the user: branch `feat/handbook-blocks`, commits, the contact sheet path, and the two follow-ups already recorded as out of scope in the spec (editor form controls; reference sets 2 and 3).
