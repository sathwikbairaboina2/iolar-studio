# Reel Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reel can carry a pattern (`tools` first): its approved script is split into the pattern's sections, voiced from the script lines, given a presenter clip, and rendered by the templates service on :26200 into `export/reel.mp4`; the creator preset formerly called `pattern` becomes `style`.

**Architecture:** Sections hold script line ids plus on-screen copy and live in `reel.pattern`; a registry of `PatternDef`s (`lib/reel/pattern/`) owns each pattern's zod, Claude prompt, unit order and document builder; a derived-from-disk stage machine (`lib/reel/pattern/run.ts`) advances SECTION → VOICE → ALIGN → PRESENT → RENDER; a thin client (`lib/reel/pattern/service.ts`) talks to the service; a `PatternBoard` tab drives it. Beats are untouched and freeform reels behave as before.

**Tech Stack:** Next.js (App Router, `--webpack`), TypeScript, zod 4, antd, vitest + @testing-library/react (jsdom), Claude CLI via `runClaude`, ffmpeg, whisper alignment already in repo, templates service (FastAPI) on 26200.

**Spec:** `docs/superpowers/specs/2026-09-03-reel-patterns-design.md`

## Global Constraints

- Repo: `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`, branch `feat/knowledge-layer`. Another session may be editing `lib/jobs/*`; do not touch those files.
- Run tests with `npx vitest run <file>`; typecheck with `npx tsc --noEmit -p .`. Dev server: `npx next dev --webpack -p 3120` (never `npm run dev`).
- Tests never touch real services: fake `fetch`, fake Claude, `IOLAR_DATA_DIR` set to a temp dir in `beforeEach` (pattern in `tests/api.reel.test.ts`).
- Every asset URL sent to the service is `file://` + an absolute path under the reel dir, or an `http(s)://` URL copied from a research candidate. Never a bare path.
- Limits, defaults, theme ids and template names come from the service's `GET /templates`; never hardcode 60/40/16/12 in production code (tests may pin them).
- `sec` is never stored on a section. Unit boundaries are always script-line boundaries.
- Claude output is checked and retried once; a second failure is shown, never silently accepted.
- Commit after every task with a `feat:`/`refactor:`/`test:` message ending in the attribution trailer used in this repo:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JTDUxYfkXvxtdhjENnb6hg
  ```

## File structure

| File | Responsibility |
|---|---|
| `lib/reel/style-schema.ts`, `lib/reel/styles.ts` | renamed from `pattern-schema.ts` / `patterns.ts`: the creator preset |
| `styles/armand/{style.json,caption.css,hook.html}` | renamed from `patterns/armand/` |
| `lib/reel/schema.ts` | `style` field, new `pattern` block, legacy migration in `validateReel` |
| `lib/reel/script.ts` | `voScriptFor(reel, script)` and `textHash(text)` so pattern reels voice the script lines |
| `lib/paths.ts` | `stylesRoot`, `styleDir`, `reelPresenterFile`, `reelPatternDir`, `reelPatternHookAudio`, `reelPatternTimelineFile` |
| `lib/reel/pattern/types.ts` | `PatternDef`, `Unit`, `UnitTime`, `SectionError`, `Limits`, `TemplateInfo` |
| `lib/reel/pattern/service.ts` | HTTP client for :26200 |
| `lib/reel/pattern/tools.ts` | the `tools` PatternDef |
| `lib/reel/pattern/index.ts` | `PATTERNS`, `patternDef(name)`, `availablePatterns()` |
| `lib/reel/pattern/timing.ts` | `lineSpans`, `unitTimes`, `defaultTimes`, `UnitTooLong` |
| `lib/reel/pattern/document.ts` | `buildDocument(slug)`, `docHash` |
| `lib/reel/pattern/section.ts` | SECTION stage: Claude call, parse, retry |
| `lib/reel/pattern/presenter.ts` | PRESENT stage: hook audio cut, lipsync submit/poll, upload handling |
| `lib/reel/pattern/run.ts` | `patternState`, `advancePattern`, `renderPattern`, `pollRender` |
| `app/api/reel/patterns/route.ts` | list of available patterns (was the style list; that moves to `/api/reel/styles`) |
| `app/api/reel/[slug]/pattern/{route,section,advance,render}/route.ts` | board API |
| `app/api/reel/[slug]/presenter/route.ts` | hook clip upload |
| `components/reel/PatternBoard.tsx` | the Pattern tab |
| `app/reel/page.tsx`, `app/reel/[slug]/page.tsx` | pattern pick on create; tab fork |
| `lib/plugins/registry.ts` | `templates` plugin card |

---

### Task 1: Rename the creator preset from `pattern` to `style`

**Files:**
- Rename: `patterns/` → `styles/`, `patterns/armand/pattern.json` → `styles/armand/style.json`
- Rename: `lib/reel/pattern-schema.ts` → `lib/reel/style-schema.ts`, `lib/reel/patterns.ts` → `lib/reel/styles.ts`
- Rename: `app/api/reel/patterns/route.ts` → `app/api/reel/styles/route.ts`, `app/api/reel/patterns/clone/route.ts` → `app/api/reel/styles/clone/route.ts`, `app/api/reel/patterns/css/route.ts` → `app/api/reel/styles/css/route.ts`
- Rename: `tests/reel.patterns.test.ts` → `tests/reel.styles.test.ts`
- Modify: `lib/paths.ts:67-68`, `lib/reel/schema.ts` (field + `validateReel`), `lib/settings.ts` (`reelStyle` + legacy key), `lib/reel/clone.ts`, `lib/reel/assemble.ts`, `lib/reel/build/bridge.ts`, `lib/reel/shots.ts`, `lib/reel/store.ts`, `lib/reel/voice.ts`, `lib/ai/reel/plan.ts`, `app/api/reel/route.ts`, `app/api/reel/[slug]/assemble/route.ts`, `app/reel/page.tsx`, `app/reel/[slug]/page.tsx`, `components/reel/Player.tsx`, `tests/reel.onetake.test.ts`, `tests/reel.plan.test.ts`, `tests/reel.player.test.tsx`, `tests/reel.wholeclip.test.ts`
- Test: `tests/reel.styles.test.ts`, `tests/reel.pattern.schema.test.ts` (new)

**Interfaces:**
- Produces: `loadStyle(name): Promise<Style>`, `listStyles(): Promise<StyleMeta[]>`, `styleCss(name)`, `styleHookHtml(name)`, `validateStyle(data)`, `styleCssVars(s: Style)` from `lib/reel/styles.ts` / `lib/reel/style-schema.ts`; `reel.style: string`; settings `reelStyle`; `stylesRoot()`, `styleDir(name)` in `lib/paths.ts`.

- [ ] **Step 1: Write the failing migration test**

`tests/reel.pattern.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateReel, emptyReel } from '@/lib/reel/schema';

describe('reel style and pattern fields', () => {
  it('migrates a legacy string pattern into style and leaves pattern null', () => {
    const legacy = { ...emptyReel('x'), pattern: 'armand' } as unknown as Record<string, unknown>;
    delete legacy.style;
    const reel = validateReel(legacy);
    expect(reel.style).toBe('armand');
    expect(reel.pattern).toBeNull();
  });

  it('defaults style to armand and pattern to null on a fresh reel', () => {
    const reel = emptyReel('fresh');
    expect(reel.style).toBe('armand');
    expect(reel.pattern).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/reel.pattern.schema.test.ts`
Expected: FAIL — `reel.style` is undefined.

- [ ] **Step 3: Move the files with git**

```bash
git mv patterns styles
git mv styles/armand/pattern.json styles/armand/style.json
git mv lib/reel/pattern-schema.ts lib/reel/style-schema.ts
git mv lib/reel/patterns.ts lib/reel/styles.ts
git mv app/api/reel/patterns app/api/reel/styles
git mv tests/reel.patterns.test.ts tests/reel.styles.test.ts
```

Check `git status` shows only renames plus nothing under `app/api/reel/patterns/` (the pattern list route is recreated in Task 10).

- [ ] **Step 4: Rename the symbols**

In `lib/reel/style-schema.ts`: `PatternSchema` → `StyleSchema`, `Pattern` → `Style`, `PatternMeta` → `StyleMeta`, `validatePattern` → `validateStyle`, `patternCssVars` → `styleCssVars`. Update the header comment to say "style".

In `lib/reel/styles.ts`: imports from `./style-schema`; `loadPattern` → `loadStyle` reading `style.json`; `listPatterns` → `listStyles`; `patternCss` → `styleCss`; `patternHookHtml` → `styleHookHtml`; `patternDir`/`patternsRoot` → `styleDir`/`stylesRoot`.

In `lib/paths.ts:67-68`:

```ts
/** Reels live in a flat per-slug tree; styles are repo assets, not user data. */
export function stylesRoot() { return path.join(process.cwd(), 'styles'); }
export function styleDir(name: string) { return path.join(stylesRoot(), name); }
```

In `lib/reel/schema.ts`: replace `pattern: z.string().default('armand'),` with `style: z.string().default('armand'),` (the new `pattern` block is Task 2; for now leave `pattern` out) and make `validateReel` migrate:

```ts
export function validateReel(data: unknown): Reel {
  // Reels written before 3 September 2026 carried the creator preset as `pattern`.
  if (data && typeof data === 'object' && typeof (data as { pattern?: unknown }).pattern === 'string') {
    const d = data as Record<string, unknown>;
    data = { ...d, style: d.style ?? d.pattern, pattern: null };
  }
  return ReelSchema.parse(data);
}
```

In `lib/settings.ts`: `reelPattern: string` → `reelStyle: string`, default `reelStyle: 'armand'`, and in `getSettings`:

```ts
export function getSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    // The preset key was renamed on 3 September 2026; an old file still reads.
    if (typeof raw.reelPattern === 'string' && raw.reelStyle === undefined) raw.reelStyle = raw.reelPattern;
    delete raw.reelPattern;
    return { ...DEFAULTS, ...raw } as Settings;
  } catch {
    return { ...DEFAULTS };
  }
}
```

Every other file in the Files list: `loadPattern` → `loadStyle`, `Pattern` type → `Style`, `reel.pattern` → `reel.style`, `s.reelPattern` → `s.reelStyle`, `patternCssVars` → `styleCssVars`, `validatePattern` → `validateStyle`, `clonePattern` → `cloneStyle` (writes `style.json`, copies from `stylesRoot()/armand`), `patternDir`/`patternsRoot` → `styleDir`/`stylesRoot`, `AssembleInput.pattern` → `style` (and callers `assemble({ reel, style })`), `Player` prop `pattern` → `style`, `app/reel/[slug]/page.tsx` state `pattern` → `style` fetching `/api/reel/styles?name=`, `app/reel/page.tsx` select → styles from `/api/reel/styles`, column title "Style", `POST /api/reel` body key `style`. In `lib/reel/store.ts` `ReelMeta.pattern` → `style`. Route files under `app/api/reel/styles/` use the new names and the JSON keys `styles` / `style`.

- [ ] **Step 5: Sweep for leftovers**

Run: `grep -rn "loadPattern\|listPatterns\|patternCssVars\|validatePattern\|PatternMeta\|reelPattern\|patternDir\|patternsRoot\|reel\.pattern\b\|clonePattern\|patternCss\|patternHookHtml" --include=*.ts --include=*.tsx lib app components tests`
Expected: no output.

- [ ] **Step 6: Typecheck and run the affected suites**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.styles.test.ts tests/reel.pattern.schema.test.ts tests/reel.onetake.test.ts tests/reel.plan.test.ts tests/reel.player.test.tsx tests/reel.wholeclip.test.ts tests/api.reel.test.ts`
Expected: typecheck clean, all pass. `tests/reel.styles.test.ts` must import `loadStyle`, `listStyles`, `styleCssVars`, `validateStyle`, `styleCss`, `styleHookHtml` from `@/lib/reel/styles`.

- [ ] **Step 7: Commit**

```bash
git add -A styles lib app components tests
git commit -m "refactor(reel): the creator preset is a style; pattern is freed for section structure"
```

---

### Task 2: The `reel.pattern` block, voice text from script lines, new paths

**Files:**
- Modify: `lib/reel/schema.ts`, `lib/reel/script.ts`, `lib/reel/voice.ts`, `app/api/reel/[slug]/voice/route.ts`, `lib/paths.ts`
- Test: `tests/reel.pattern.schema.test.ts`, `tests/reel.voice.test.ts` (one new case)

**Interfaces:**
- Produces: `ReelPattern` type (`reel.pattern`), `PATTERN_JOB_STATES`; `voScriptFor(reel, script: Script | null): string`; `textHash(text: string): string`; `scriptHashFor(reel, script)`; `reelPresenterFile(slug)`, `reelPatternDir(slug)`, `reelPatternHookAudio(slug)`, `reelPatternTimelineFile(slug)`.

- [ ] **Step 1: Extend the schema test**

Append to `tests/reel.pattern.schema.test.ts`:

```ts
it('round-trips a pattern block with defaults filled', () => {
  const reel = validateReel({ ...emptyReel('p'), pattern: { name: 'tools', theme: 'kinetic' } });
  expect(reel.pattern).toEqual({
    name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: [], job: null,
  });
});

it('keeps a job and its hashes', () => {
  const reel = validateReel({
    ...emptyReel('p'),
    pattern: {
      name: 'tools', theme: 'kinetic', scriptHash: 'abc',
      sections: [{ kind: 'hook', lineIds: ['l1'] }],
      job: { id: 'j1', state: 'rendering', submittedAt: '2026-09-03T00:00:00.000Z', docHash: 'd1' },
    },
  });
  expect(reel.pattern?.job?.error).toBeNull();
  expect(reel.pattern?.sections[0]).toMatchObject({ kind: 'hook' });
});

it('rejects a job in an unknown state', () => {
  expect(() =>
    validateReel({ ...emptyReel('p'), pattern: { name: 'tools', theme: 'k', job: { id: 'j', state: 'lost', submittedAt: 'x', docHash: 'd' } } })
  ).toThrow();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.schema.test.ts`
Expected: FAIL — `pattern` is stripped or rejected.

- [ ] **Step 3: Add the block to `lib/reel/schema.ts`**

Above `ReelSchema`:

```ts
export const PATTERN_JOB_STATES = ['queued', 'preparing', 'rendering', 'done', 'failed'] as const;

/**
 * A pattern reel: the approved script split into a template's sections and rendered by
 * the templates service. Sections are pattern-specific and validated by the pattern
 * definition (`lib/reel/pattern/`), never here, so a new pattern does not touch this file.
 */
export const ReelPatternSchema = z.object({
  /** A template the service lists in GET /templates. */
  name: z.string().min(1),
  /** One of that template's themes. */
  theme: z.string().min(1),
  /** Where the hook's presenter clip comes from; an uploaded clip flips this to upload. */
  presenter: z.enum(['lipsync', 'upload']).default('lipsync'),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  /** Fingerprint of the script lines the sections were made from; absent until sectioned. */
  scriptHash: z.string().optional(),
  /** The last render on the service. */
  job: z
    .object({
      id: z.string().min(1),
      state: z.enum(PATTERN_JOB_STATES),
      submittedAt: z.string(),
      /** Fingerprint of the document sent, so an edit after submit is visible. */
      docHash: z.string(),
      error: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type ReelPattern = z.infer<typeof ReelPatternSchema>;
```

In `ReelSchema`, after `style`: `pattern: ReelPatternSchema.nullable().default(null),`. Export `export type ReelPatternJob = NonNullable<ReelPattern['job']>;`.

- [ ] **Step 4: Voice text for pattern reels**

`lib/reel/script.ts` — add, keeping the existing functions:

```ts
import type { Script } from './research/script';

/** FNV-1a of a string, base36; the fingerprint every "did the words change" check uses. */
export function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** The script lines in order, spoken as one text. */
export function linesText(script: Script): string {
  return [...script.lines].sort((a, b) => a.order - b.order).map((l) => l.text.trim()).join(' ');
}

/**
 * What the voiceover speaks: a pattern reel reads its approved script lines, a freeform
 * reel reads its beats. One definition, so the synthesiser, the aligner and the panel
 * that shows the text to a creator all agree.
 */
export function voScriptFor(reel: { pattern: { name: string } | null; beats: { text: string }[] }, script: Script | null): string {
  if (reel.pattern && script) return linesText(script);
  return voScript(reel);
}

export function scriptHashFor(reel: { pattern: { name: string } | null; beats: { text: string }[] }, script: Script | null): string {
  return textHash(voScriptFor(reel, script));
}
```

Make `scriptHash(reel)` call `textHash(voScript(reel))` so the two agree.

`lib/reel/voice.ts`: add `import * as research from './research/store';` and a helper:

```ts
/** The approved script when this is a pattern reel; null otherwise (a freeform reel voices its beats). */
async function scriptFor(slug: string, reel: Reel) {
  if (!reel.pattern) return null;
  return research.readScript(slug);
}
```

In `alignExistingVoice`: `const script = await scriptFor(slug, reel); const words = await alignVoice(audio, voScriptFor(reel, script));` and `scriptHash: scriptHashFor(reel, script)`. In `synthesizeVoice`: `const script = voScriptFor(reel, await scriptFor(slug, reel));`.

`app/api/reel/[slug]/voice/route.ts:46-50`: load `const script = reel.pattern ? await research.readScript(slug).catch(() => null) : null;` and use `voScriptFor(reel, script)`, `voScriptFor(reel, script).split(/\s+/).filter(Boolean).length` for `scriptWords`, and `matchesScript: reel.vo.scriptHash ? reel.vo.scriptHash === scriptHashFor(reel, script) : null`.

- [ ] **Step 5: Paths**

`lib/paths.ts`, after `reelExportDir`:

```ts
/** The hook clip a user dropped for a pattern reel; when present it beats the lipsync render. */
export function reelPresenterFile(slug: string) { return path.join(reelDir(slug), 'presenter.mp4'); }
/** Working files of the pattern pipeline: the hook's audio cut, the service's timeline. */
export function reelPatternDir(slug: string) { return path.join(reelDir(slug), 'pattern'); }
export function reelPatternHookAudio(slug: string) { return path.join(reelPatternDir(slug), 'hook.wav'); }
export function reelPatternTimelineFile(slug: string) { return path.join(reelPatternDir(slug), 'timeline.json'); }
```

- [ ] **Step 6: Voice test for the fork**

Append to `tests/reel.voice.test.ts` (follow its existing mocking of `speak`/`alignVoice`; if the file mocks `@/lib/reel/tts` and `@/lib/reel/align`, reuse those mocks):

```ts
it('voices a pattern reel from its script lines, not its beats', async () => {
  const { voScriptFor, scriptHashFor } = await import('@/lib/reel/script');
  const script = {
    runId: 'r', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', status: 'approved' as const,
    lines: [
      { id: 'l2', order: 1, role: 'body' as const, text: 'Second.', citations: [], assetIds: [], note: null, commentary: false },
      { id: 'l1', order: 0, role: 'hook' as const, text: 'First.', citations: [], assetIds: [], note: null, commentary: false },
    ],
    unsupported: [], coverage: [], flags: [],
  };
  const reel = { pattern: { name: 'tools' }, beats: [{ text: 'Beat text.' }] };
  expect(voScriptFor(reel, script)).toBe('First. Second.');
  expect(voScriptFor({ ...reel, pattern: null }, script)).toBe('Beat text.');
  expect(scriptHashFor(reel, script)).not.toBe(scriptHashFor({ ...reel, pattern: null }, script));
});
```

- [ ] **Step 7: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.schema.test.ts tests/reel.voice.test.ts tests/api.reel.voice.test.ts`
Expected: pass.

```bash
git add lib/reel/schema.ts lib/reel/script.ts lib/reel/voice.ts "app/api/reel/[slug]/voice/route.ts" lib/paths.ts tests/reel.pattern.schema.test.ts tests/reel.voice.test.ts
git commit -m "feat(reel): a reel may carry a pattern; pattern reels voice their script lines"
```

---

### Task 3: Service client and the plugin card

**Files:**
- Create: `lib/reel/pattern/service.ts`
- Modify: `lib/plugins/registry.ts` (`PluginName`, `PLUGINS`)
- Test: `tests/reel.pattern.service.test.ts`, `tests/plugins.registry.test.ts` (one case; create the file if none exists)

**Interfaces:**
- Produces:
  ```ts
  export type TemplateInfo = { name: string; displayName: string; sections: string[]; required: string[];
    defaults: Record<string, number>; limits: Record<string, number>; themes: string[]; samples: Record<string, unknown> };
  export type ServiceJob = { id: string; state: 'queued'|'preparing'|'rendering'|'done'|'failed'; progress: number; error: string | null; timeline: unknown | null };
  export type ValidationIssue = { loc: (string | number)[]; msg: string };
  export class ServiceDown extends Error {}
  export class ServiceRejected extends Error { issues: ValidationIssue[] }
  export type ServiceOpts = { baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number };
  export function templatesBase(): string;
  export async function templates(opts?): Promise<TemplateInfo[]>;          // cached 60 s per base
  export async function validate(doc: unknown, opts?): Promise<unknown>;    // timeline, throws ServiceRejected on 422
  export async function submit(doc: unknown, opts?): Promise<{ id: string }>;
  export async function job(id: string, opts?): Promise<ServiceJob>;
  export async function log(id: string, opts?): Promise<string>;
  export async function download(id: string, dest: string, opts?): Promise<void>;
  export function previewUrl(name: string, theme: string, jobId?: string, base?: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/reel.pattern.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

type Reply = { status?: number; body?: unknown; bytes?: Uint8Array; fail?: boolean };
const fake = (routes: Record<string, Reply>) => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    const r = routes[key ?? ''] ?? { status: 404, body: { detail: 'no route' } };
    if (r.fail) throw new Error('connect ECONNREFUSED');
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

const template = { name: 'tools', displayName: 'Tools', sections: ['hook', 'slides', 'web', 'cta'], required: ['hook', 'cta'], defaults: { hook: 10, slide: 6, page: 4, cta: 5 }, limits: { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 }, themes: ['kinetic'], samples: {} };

describe('templates service client', () => {
  beforeEach(() => vi.resetModules());

  it('lists templates and caches them for a minute per base', async () => {
    const S = await import('@/lib/reel/pattern/service');
    const { f, calls } = fake({ '/templates': { body: { templates: [template] } } });
    let now = 1000;
    const opts = { baseUrl: 'http://x', fetchImpl: f, now: () => now };
    expect((await S.templates(opts))[0].limits.title).toBe(60);
    await S.templates(opts);
    expect(calls.length).toBe(1);
    now += 61_000;
    await S.templates(opts);
    expect(calls.length).toBe(2);
  });

  it('turns a 422 from validate into field issues', async () => {
    const S = await import('@/lib/reel/pattern/service');
    const { f } = fake({ '/validate': { status: 422, body: { detail: [{ loc: ['body', 'sections', 0, 'hook', 'title'], msg: 'String should have at most 60 characters', type: 'string_too_long' }] } } });
    await expect(S.validate({}, { baseUrl: 'http://x', fetchImpl: f })).rejects.toMatchObject({
      issues: [{ loc: ['sections', 0, 'hook', 'title'], msg: 'String should have at most 60 characters' }],
    });
  });

  it('submits, polls, and downloads the reel', async () => {
    const S = await import('@/lib/reel/pattern/service');
    const dir = mkdtempSync(path.join(tmpdir(), 'svc-'));
    const { f, calls } = fake({
      '/jobs': { status: 202, body: { id: 'j1' } },
      '/jobs/j1': { body: { state: 'done', progress: 1, error: null, timeline: { durationSec: 12 } } },
      '/jobs/j1/reel.mp4': { bytes: new TextEncoder().encode('mp4!') },
    });
    const opts = { baseUrl: 'http://x', fetchImpl: f };
    expect(await S.submit({ template: 'tools' }, opts)).toEqual({ id: 'j1' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://x/jobs' });
    expect((await S.job('j1', opts)).state).toBe('done');
    await S.download('j1', path.join(dir, 'reel.mp4'), opts);
    expect(readFileSync(path.join(dir, 'reel.mp4'), 'utf8')).toBe('mp4!');
  });

  it('names the base when the service is down, and builds the preview url', async () => {
    const S = await import('@/lib/reel/pattern/service');
    const { f } = fake({ '/templates': { fail: true } });
    await expect(S.templates({ baseUrl: 'http://x', fetchImpl: f })).rejects.toThrow(/http:\/\/x/);
    expect(S.previewUrl('tools', 'kinetic', 'j1', 'http://x')).toBe('http://x/preview/tools/kinetic?job=j1');
    expect(S.previewUrl('tools', 'kinetic', undefined, 'http://x')).toBe('http://x/preview/tools/kinetic');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

`lib/reel/pattern/service.ts`:

```ts
import { promises as fs } from 'fs';
import path from 'path';

/**
 * The reels templates service (main-reels-templates-plugin, FastAPI on 26200): one JSON
 * document in, one mp4 out. This is the whole of what the studio knows about it. Names,
 * themes, limits and default seconds are read from it, never restated here.
 */

export type TemplateInfo = {
  name: string;
  displayName: string;
  sections: string[];
  required: string[];
  defaults: Record<string, number>;
  limits: Record<string, number>;
  themes: string[];
  samples: Record<string, unknown>;
};
export type ServiceJobState = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed';
export type ServiceJob = { id: string; state: ServiceJobState; progress: number; error: string | null; timeline: unknown | null };
export type ValidationIssue = { loc: (string | number)[]; msg: string };
export type ServiceOpts = { baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number };

export class ServiceDown extends Error {}
export class ServiceRejected extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.loc.join('.')}: ${i.msg}`).join('; ') || 'the service rejected the document');
  }
}

export const templatesBase = (): string => (process.env.REELS_TEMPLATES_URL ?? 'http://127.0.0.1:26200').replace(/\/$/, '');

const READ_MS = 8000;
const WRITE_MS = 30_000;

function client(opts: ServiceOpts) {
  return { base: (opts.baseUrl ?? templatesBase()).replace(/\/$/, ''), http: opts.fetchImpl ?? fetch, now: opts.now ?? Date.now };
}

async function call(pathname: string, init: RequestInit & { timeoutMs: number }, opts: ServiceOpts): Promise<Response> {
  const { base, http } = client(opts);
  try {
    return await http(`${base}${pathname}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs), cache: 'no-store' });
  } catch (err) {
    throw new ServiceDown(`reels-templates is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}; start it from Plugins`);
  }
}

/** FastAPI's 422 shape; the leading "body" segment is the request, not the document. */
function issuesOf(body: unknown): ValidationIssue[] {
  const detail = (body as { detail?: unknown })?.detail;
  if (!Array.isArray(detail)) return [{ loc: [], msg: typeof detail === 'string' ? detail : 'invalid document' }];
  return detail.map((d) => {
    const loc = Array.isArray(d.loc) ? (d.loc as (string | number)[]) : [];
    return { loc: loc[0] === 'body' ? loc.slice(1) : loc, msg: String(d.msg ?? 'invalid') };
  });
}

const cache = new Map<string, { at: number; templates: TemplateInfo[] }>();
const CACHE_MS = 60_000;

export async function templates(opts: ServiceOpts = {}): Promise<TemplateInfo[]> {
  const { base, now } = client(opts);
  const hit = cache.get(base);
  if (hit && now() - hit.at < CACHE_MS) return hit.templates;
  const res = await call('/templates', { timeoutMs: READ_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for /templates`);
  const body = (await res.json()) as { templates?: TemplateInfo[] };
  const list = body.templates ?? [];
  cache.set(base, { at: now(), templates: list });
  return list;
}

export async function validate(doc: unknown, opts: ServiceOpts = {}): Promise<unknown> {
  const res = await call('/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc), timeoutMs: WRITE_MS }, opts);
  if (res.status === 422) throw new ServiceRejected(issuesOf(await res.json().catch(() => ({}))));
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for /validate`);
  return res.json();
}

export async function submit(doc: unknown, opts: ServiceOpts = {}): Promise<{ id: string }> {
  const res = await call('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc), timeoutMs: WRITE_MS }, opts);
  const body = await res.json().catch(() => ({}));
  if (res.status === 422) throw new ServiceRejected(issuesOf(body));
  if (res.status === 503) throw new ServiceDown(`reels-templates is missing tools: ${((body as { missing?: string[] }).missing ?? []).join(', ')}`);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for POST /jobs`);
  return { id: String((body as { id?: string }).id ?? '') };
}

export async function job(id: string, opts: ServiceOpts = {}): Promise<ServiceJob> {
  const res = await call(`/jobs/${encodeURIComponent(id)}`, { timeoutMs: READ_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for job ${id}`);
  const b = (await res.json()) as Partial<ServiceJob>;
  return { id, state: (b.state ?? 'failed') as ServiceJobState, progress: Number(b.progress ?? 0), error: b.error ?? null, timeline: b.timeline ?? null };
}

export async function log(id: string, opts: ServiceOpts = {}): Promise<string> {
  const res = await call(`/jobs/${encodeURIComponent(id)}/log`, { timeoutMs: READ_MS }, opts);
  return res.ok ? res.text() : '';
}

export async function download(id: string, dest: string, opts: ServiceOpts = {}): Promise<void> {
  const res = await call(`/jobs/${encodeURIComponent(id)}/reel.mp4`, { timeoutMs: WRITE_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for the reel of job ${id}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** The service's own player page: the real composition with a scrubber, no encode. */
export function previewUrl(name: string, theme: string, jobId?: string, base = templatesBase()): string {
  const url = `${base}/preview/${encodeURIComponent(name)}/${encodeURIComponent(theme)}`;
  return jobId ? `${url}?job=${encodeURIComponent(jobId)}` : url;
}
```

- [ ] **Step 4: Plugin card**

`lib/plugins/registry.ts`: add `'templates'` to `PluginName`; add `const templatesBase = (process.env.REELS_TEMPLATES_URL ?? 'http://127.0.0.1:26200').replace(/\/$/, '');` beside the others; append to `PLUGINS`:

```ts
  {
    name: 'templates',
    label: 'reels-templates',
    port: port(templatesBase),
    healthUrl: `${templatesBase}/health`,
    what: 'Renders a pattern reel from one document with Remotion; the Pattern tab sends it the sections and takes the mp4 back.',
    openUrl: `${templatesBase}/docs`,
    start: {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', 'run.ps1'],
      cwd: `${PLUGIN_ROOT}/plugins/main-reels-templates-plugin`,
      hint: String.raw`.\run.ps1`,
    },
  },
```

Test (add to the existing registry test file, or create `tests/plugins.registry.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { PLUGINS } from '@/lib/plugins/registry';

describe('plugin registry', () => {
  it('lists the templates service on 26200 with its health url', () => {
    const t = PLUGINS.find((p) => p.name === 'templates')!;
    expect(t.port).toBe(26200);
    expect(t.healthUrl).toBe('http://127.0.0.1:26200/health');
    expect(t.start?.cwd).toMatch(/main-reels-templates-plugin$/);
  });
});
```

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.service.test.ts tests/plugins.registry.test.ts tests/plugins.jobs.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/service.ts lib/plugins/registry.ts tests/reel.pattern.service.test.ts tests/plugins.registry.test.ts
git commit -m "feat(reel): client for the reels templates service; templates plugin card"
```

---

### Task 4: Pattern registry and the `tools` definition (schema, units, parse, prompt)

**Files:**
- Create: `lib/reel/pattern/types.ts`, `lib/reel/pattern/tools.ts`, `lib/reel/pattern/index.ts`
- Test: `tests/reel.pattern.tools.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type Limits = Record<string, number>;
  export type Unit = { path: string; label: string; kind: 'hook' | 'slide' | 'page' | 'cta' | string; lineIds: string[] };
  export type UnitTime = Unit & { sec: number; start: number; end: number };
  export class SectionError extends Error { constructor(public readonly path: string, message: string) }
  export type CandidateRef = { id: string; url: string; title: string; thumbnailUrl: string | null };
  export type Brand = { handle: string; name: string };
  export type PromptInput = { script: Script; candidates: Record<string, CandidateRef>; brand: Brand; limits: Limits; themes: string[]; errors?: string[] };
  export type DocInput = { reel: Reel; script: Script; sections: unknown[]; times: UnitTime[]; brand: Brand; captions: boolean;
    assets: { vo: string | null; presenter: string | null; words: { w: string; start: number; end: number }[] } };
  export type PatternDef = { name: string; SectionsSchema: z.ZodType<unknown[]>; prompt(input: PromptInput): string;
    parse(raw: string, script: Script, candidates: Record<string, CandidateRef>, limits: Limits): unknown[];
    check(sections: unknown[], script: Script, candidates: Record<string, CandidateRef>, limits: Limits): SectionError[];
    units(sections: unknown[]): Unit[]; doc(input: DocInput): unknown };
  ```
- Produces (`tools.ts`): `export const tools: PatternDef` and the section types `ToolsSection`, `HookSection`, `SlidesSection`, `WebSection`, `CtaSection`.
- Produces (`index.ts`): `PATTERNS: Record<string, PatternDef>`, `patternDef(name): PatternDef` (throws `unknown pattern "x"`), `availablePatterns(opts?): Promise<{ name; displayName; themes; limits; defaults }[]>` (intersection with `service.templates()`; empty list on `ServiceDown`).

- [ ] **Step 1: Write the failing tests**

`tests/reel.pattern.tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tools } from '@/lib/reel/pattern/tools';
import { patternDef, PATTERNS } from '@/lib/reel/pattern';
import type { Script } from '@/lib/reel/research/script';

const line = (id: string, order: number, role: 'hook' | 'body' | 'close', text: string, citations: string[] = []) =>
  ({ id, order, role, text, citations, assetIds: citations, note: null, commentary: false });
export const script: Script = {
  runId: 'r', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', status: 'approved',
  lines: [
    line('l1', 0, 'hook', 'Three tools nobody told you about.'),
    line('l2', 1, 'body', 'The first runs offline.', ['aaaaaaaaaaaa']),
    line('l3', 2, 'body', 'The second costs nothing.', ['bbbbbbbbbbbb']),
    line('l4', 3, 'body', 'Here is the repo.', ['aaaaaaaaaaaa']),
    line('l5', 4, 'close', 'Comment tools and I will DM you the links.'),
  ],
  unsupported: [], coverage: [], flags: [],
};
export const candidates = {
  aaaaaaaaaaaa: { id: 'aaaaaaaaaaaa', url: 'https://github.com/a', title: 'A', thumbnailUrl: 'https://img/a.png' },
  bbbbbbbbbbbb: { id: 'bbbbbbbbbbbb', url: 'https://example.com/b', title: 'B', thumbnailUrl: null },
};
export const limits = { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 };
export const good = [
  { kind: 'hook', lineIds: ['l1'], title: '3 tools nobody told you about', chips: ['free', 'local'], tease: 'the third is wild' },
  { kind: 'slides', slides: [
    { lineIds: ['l2'], topic: 'Runs offline', points: ['zero telemetry'], image: 'https://img/a.png', stats: [] },
    { lineIds: ['l3'], topic: 'Costs nothing', points: ['MIT licence', 'no signup'], image: null, stats: [] },
  ] },
  { kind: 'web', pages: [{ lineIds: ['l4'], url: 'https://github.com/a', label: 'link 1/1' }] },
  { kind: 'cta', lineIds: ['l5'], keyword: 'TOOLS', line: 'we DM you every link', follow: 'more useful tech, weekly' },
];

describe('tools pattern: prompt', () => {
  it('names every line id, every candidate url, the limits and the themes', () => {
    const p = tools.prompt({ script, candidates, brand: { handle: '@iolar', name: 'iolar' }, limits, themes: ['kinetic'] });
    for (const l of script.lines) expect(p).toContain(`[${l.id}]`);
    expect(p).toContain('https://github.com/a');
    expect(p).toContain('60');
    expect(p).toContain('kinetic');
    expect(p).toMatch(/every line id exactly once/i);
  });
  it('quotes earlier errors when retrying', () => {
    const p = tools.prompt({ script, candidates, brand: { handle: '@iolar', name: 'iolar' }, limits, themes: [], errors: ['sections.0.title: 70 characters, the limit is 60'] });
    expect(p).toContain('the limit is 60');
  });
});

describe('tools pattern: units and checks', () => {
  it('lists units in template order with their lines', () => {
    expect(tools.units(good).map((u) => [u.kind, u.lineIds])).toEqual([
      ['hook', ['l1']], ['slide', ['l2']], ['slide', ['l3']], ['page', ['l4']], ['cta', ['l5']],
    ]);
    expect(tools.units(good).map((u) => u.path)).toEqual(['sections.0', 'sections.1.slides.0', 'sections.1.slides.1', 'sections.2.pages.0', 'sections.3']);
  });
  it('passes a good document', () => {
    expect(tools.check(good, script, candidates, limits)).toEqual([]);
  });
  it('rejects a missing line, a duplicated line, and lines out of order', () => {
    const missing = structuredClone(good); (missing[2] as { pages: { lineIds: string[] }[] }).pages[0].lineIds = [];
    expect(tools.check(missing, script, candidates, limits).map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringMatching(/l4.*missing|missing.*l4/)]));
    const dup = structuredClone(good); (dup[3] as { lineIds: string[] }).lineIds = ['l4', 'l5'];
    expect(tools.check(dup, script, candidates, limits).some((e) => /l4.*twice|twice.*l4/.test(e.message))).toBe(true);
    const swapped = structuredClone(good); const s = swapped[1] as { slides: { lineIds: string[] }[] }; s.slides[0].lineIds = ['l3']; s.slides[1].lineIds = ['l2'];
    expect(tools.check(swapped, script, candidates, limits).some((e) => /order/.test(e.message))).toBe(true);
  });
  it('rejects copy over the limits with the field path', () => {
    const long = structuredClone(good); (long[0] as { title: string }).title = 'x'.repeat(61);
    const errs = tools.check(long, script, candidates, limits);
    expect(errs[0]).toMatchObject({ path: 'sections.0.title' });
    expect(errs[0].message).toContain('60');
  });
  it('rejects a page url that is not one of the candidates', () => {
    const bad = structuredClone(good); (bad[2] as { pages: { url: string }[] }).pages[0].url = 'https://evil.example/';
    expect(tools.check(bad, script, candidates, limits)[0]).toMatchObject({ path: 'sections.2.pages.0.url' });
  });
  it('requires hook and cta and refuses a second hook', () => {
    expect(tools.check(good.slice(1), script, candidates, limits).some((e) => /hook/.test(e.message))).toBe(true);
    expect(tools.check([good[0], good[0], ...good.slice(1)], script, candidates, limits).some((e) => /once|twice/.test(e.message))).toBe(true);
  });
});

describe('tools pattern: parse', () => {
  it('reads the model output, fills defaults, and applies the checks', () => {
    const raw = 'Here you go:\n```json\n' + JSON.stringify({ sections: good }) + '\n```';
    const sections = tools.parse(raw, script, candidates, limits) as typeof good;
    expect(sections[1]).toMatchObject({ kind: 'slides' });
    expect(() => tools.parse(JSON.stringify({ sections: good.slice(1) }), script, candidates, limits)).toThrow(/hook/);
  });
});

describe('registry', () => {
  it('knows tools and refuses the unknown', () => {
    expect(Object.keys(PATTERNS)).toEqual(['tools']);
    expect(patternDef('tools').name).toBe('tools');
    expect(() => patternDef('carousel')).toThrow(/unknown pattern/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.tools.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `lib/reel/pattern/types.ts`**

```ts
import type { z } from 'zod';
import type { Reel } from '../schema';
import type { Script } from '../research/script';

/**
 * What every pattern definition provides. The reel schema treats sections as opaque; a
 * definition owns their shape, the prompt that writes them, the order they are timed in,
 * and the document the templates service renders from.
 */

export type Limits = Record<string, number>;
export type Brand = { handle: string; name: string };
export type CandidateRef = { id: string; url: string; title: string; thumbnailUrl: string | null };

/** One timed stretch of the reel: the hook, one slide, one page, the cta. */
export type Unit = { path: string; label: string; kind: string; lineIds: string[] };
export type UnitTime = Unit & { sec: number; start: number; end: number };

export class SectionError extends Error {
  constructor(public readonly path: string, message: string) {
    super(message);
    this.name = 'SectionError';
  }
}

export type PromptInput = {
  script: Script;
  candidates: Record<string, CandidateRef>;
  brand: Brand;
  limits: Limits;
  themes: string[];
  /** What was wrong with the last answer, quoted back on the retry. */
  errors?: string[];
};

export type DocInput = {
  reel: Reel;
  script: Script;
  sections: unknown[];
  times: UnitTime[];
  brand: Brand;
  captions: boolean;
  assets: { vo: string | null; presenter: string | null; words: { w: string; start: number; end: number }[] };
};

export type PatternDef = {
  name: string;
  SectionsSchema: z.ZodType<unknown[]>;
  prompt(input: PromptInput): string;
  /** Model text to checked sections; throws SectionError. */
  parse(raw: string, script: Script, candidates: Record<string, CandidateRef>, limits: Limits): unknown[];
  /** Every invariant and limit; empty when the sections are sound. */
  check(sections: unknown[], script: Script, candidates: Record<string, CandidateRef>, limits: Limits): SectionError[];
  units(sections: unknown[]): Unit[];
  doc(input: DocInput): unknown;
};
```

- [ ] **Step 4: Write `lib/reel/pattern/tools.ts` (schema, units, check, parse, prompt; `doc` is Task 6)**

```ts
import { z } from 'zod';
import { extractJson } from '@/lib/ai/revise';
import type { Script } from '../research/script';
import { SectionError, type CandidateRef, type Limits, type PatternDef, type PromptInput, type Unit, type DocInput } from './types';

/**
 * Pattern `tools`: hook, slides, web, cta. The service's template.json fixes the order and
 * the limits; this file mirrors the shape and adds the one thing the service does not know
 * about — which script lines each unit speaks.
 */

const lineIds = z.array(z.string().min(1));
const StatSchema = z.object({ label: z.string(), value: z.number(), prefix: z.string().default(''), suffix: z.string().default('') });
export const HookSectionSchema = z.object({ kind: z.literal('hook'), lineIds, title: z.string(), chips: z.array(z.string()).default([]), tease: z.string().nullable().default(null), assetId: z.string().optional() });
export const SlideSchema = z.object({ lineIds, topic: z.string(), points: z.array(z.string()), image: z.string().nullable().default(null), stats: z.array(StatSchema).default([]) });
export const SlidesSectionSchema = z.object({ kind: z.literal('slides'), slides: z.array(SlideSchema) });
export const PageSchema = z.object({ lineIds, url: z.string(), label: z.string().nullable().default(null) });
export const WebSectionSchema = z.object({ kind: z.literal('web'), pages: z.array(PageSchema) });
export const CtaSectionSchema = z.object({ kind: z.literal('cta'), lineIds, keyword: z.string(), line: z.string(), follow: z.string() });
export const ToolsSectionSchema = z.discriminatedUnion('kind', [HookSectionSchema, SlidesSectionSchema, WebSectionSchema, CtaSectionSchema]);
export const ToolsSectionsSchema = z.array(ToolsSectionSchema);

export type HookSection = z.infer<typeof HookSectionSchema>;
export type SlidesSection = z.infer<typeof SlidesSectionSchema>;
export type WebSection = z.infer<typeof WebSectionSchema>;
export type CtaSection = z.infer<typeof CtaSectionSchema>;
export type ToolsSection = z.infer<typeof ToolsSectionSchema>;

const ORDER = ['hook', 'slides', 'web', 'cta'] as const;

function units(sections: unknown[]): Unit[] {
  const out: Unit[] = [];
  (sections as ToolsSection[]).forEach((s, i) => {
    if (s.kind === 'hook') out.push({ path: `sections.${i}`, label: 'hook', kind: 'hook', lineIds: s.lineIds });
    else if (s.kind === 'cta') out.push({ path: `sections.${i}`, label: 'cta', kind: 'cta', lineIds: s.lineIds });
    else if (s.kind === 'slides') s.slides.forEach((sl, j) => out.push({ path: `sections.${i}.slides.${j}`, label: `slide ${j + 1}`, kind: 'slide', lineIds: sl.lineIds }));
    else s.pages.forEach((p, j) => out.push({ path: `sections.${i}.pages.${j}`, label: `page ${j + 1}`, kind: 'page', lineIds: p.lineIds }));
  });
  return out;
}

const over = (path: string, what: string, got: number, limit: number) => new SectionError(path, `${what} is ${got}, the limit is ${limit}`);

function check(raw: unknown[], script: Script, candidates: Record<string, CandidateRef>, limits: Limits): SectionError[] {
  const parsed = ToolsSectionsSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return [new SectionError(['sections', ...i.path].join('.'), i.message)];
  }
  const sections = parsed.data;
  const errs: SectionError[] = [];

  // Kinds: hook and cta once each, others at most once, template order.
  const kinds = sections.map((s) => s.kind);
  for (const k of ['hook', 'cta'] as const) if (!kinds.includes(k)) errs.push(new SectionError('sections', `a ${k} section is required`));
  for (const k of ORDER) if (kinds.filter((x) => x === k).length > 1) errs.push(new SectionError('sections', `the ${k} section may appear once, not twice`));
  const ranks = kinds.map((k) => ORDER.indexOf(k));
  if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) errs.push(new SectionError('sections', `sections must follow the order ${ORDER.join(', ')}`));
  if (errs.length) return errs;

  // Lines: every one placed once, units in script order, no empty unit.
  const order = new Map([...script.lines].sort((a, b) => a.order - b.order).map((l, i) => [l.id, i]));
  const seen = new Map<string, string>();
  let cursor = -1;
  for (const u of units(sections)) {
    if (u.lineIds.length === 0) errs.push(new SectionError(u.path, `${u.label} speaks no line`));
    for (const id of u.lineIds) {
      const rank = order.get(id);
      if (rank === undefined) { errs.push(new SectionError(u.path, `${id} is not a line of this script`)); continue; }
      if (seen.has(id)) errs.push(new SectionError(u.path, `${id} is placed twice (${seen.get(id)} and ${u.label})`));
      seen.set(id, u.label);
      if (rank < cursor) errs.push(new SectionError(u.path, `${id} is out of order: ${u.label} comes after a later line`));
      cursor = Math.max(cursor, rank);
    }
  }
  for (const id of order.keys()) if (!seen.has(id)) errs.push(new SectionError('sections', `${id} is missing from every section`));

  // Limits, as the service states them.
  const len = (s: string) => s.trim().length;
  sections.forEach((s, i) => {
    const at = `sections.${i}`;
    if (s.kind === 'hook') {
      if (len(s.title) === 0 || len(s.title) > limits.title) errs.push(over(`${at}.title`, 'title length', len(s.title), limits.title));
      if (s.chips.length > limits.chips) errs.push(over(`${at}.chips`, 'chip count', s.chips.length, limits.chips));
      s.chips.forEach((c, j) => { if (len(c) === 0 || len(c) > limits.chip) errs.push(over(`${at}.chips.${j}`, 'chip length', len(c), limits.chip)); });
      if (s.tease !== null && len(s.tease) > limits.title) errs.push(over(`${at}.tease`, 'tease length', len(s.tease), limits.title));
    } else if (s.kind === 'slides') {
      if (s.slides.length === 0 || s.slides.length > 12) errs.push(over(`${at}.slides`, 'slide count', s.slides.length, 12));
      s.slides.forEach((sl, j) => {
        const p = `${at}.slides.${j}`;
        if (len(sl.topic) === 0 || len(sl.topic) > limits.topic) errs.push(over(`${p}.topic`, 'topic length', len(sl.topic), limits.topic));
        if (sl.points.length === 0 || sl.points.length > limits.points) errs.push(over(`${p}.points`, 'point count', sl.points.length, limits.points));
        sl.points.forEach((pt, k) => { if (len(pt) === 0 || len(pt) > limits.point) errs.push(over(`${p}.points.${k}`, 'point length', len(pt), limits.point)); });
        if (sl.stats.length > 3) errs.push(over(`${p}.stats`, 'stat count', sl.stats.length, 3));
        if (sl.image !== null && !/^https?:\/\//.test(sl.image)) errs.push(new SectionError(`${p}.image`, 'image must be an http(s) url or null'));
      });
    } else if (s.kind === 'web') {
      if (s.pages.length === 0 || s.pages.length > 10) errs.push(over(`${at}.pages`, 'page count', s.pages.length, 10));
      const urls = new Set(Object.values(candidates).map((c) => c.url));
      s.pages.forEach((pg, j) => {
        const p = `${at}.pages.${j}`;
        if (!urls.has(pg.url)) errs.push(new SectionError(`${p}.url`, `${pg.url} is not one of the script's sources`));
        if (pg.label !== null && len(pg.label) > 20) errs.push(over(`${p}.label`, 'label length', len(pg.label), 20));
      });
    } else {
      if (len(s.keyword) === 0 || len(s.keyword) > limits.keyword) errs.push(over(`${at}.keyword`, 'keyword length', len(s.keyword), limits.keyword));
      if (len(s.line) === 0 || len(s.line) > limits.title) errs.push(over(`${at}.line`, 'line length', len(s.line), limits.title));
      if (len(s.follow) === 0 || len(s.follow) > limits.title) errs.push(over(`${at}.follow`, 'follow length', len(s.follow), limits.title));
    }
  });
  return errs;
}

function parse(raw: string, script: Script, candidates: Record<string, CandidateRef>, limits: Limits): unknown[] {
  const data = extractJson(raw) as { sections?: unknown[] };
  const sections = Array.isArray(data.sections) ? data.sections : [];
  if (sections.length === 0) throw new SectionError('sections', 'the answer has no sections');
  const errs = check(sections, script, candidates, limits);
  if (errs.length) throw errs[0];
  return ToolsSectionsSchema.parse(sections);
}

function prompt(input: PromptInput): string {
  const { script, candidates, brand, limits, themes } = input;
  const lines = [...script.lines].sort((a, b) => a.order - b.order)
    .map((l) => `[${l.id}] (${l.role}) ${l.text}${l.citations.length ? `  sources: ${l.citations.filter((c) => candidates[c]).join(', ')}` : ''}`)
    .join('\n');
  const sources = Object.values(candidates).map((c) => `${c.id}: ${c.url} — ${c.title}${c.thumbnailUrl ? ` (image: ${c.thumbnailUrl})` : ''}`).join('\n');
  const shape = `Return ONLY JSON (no prose, no markdown fences):
{ "sections": [
  { "kind": "hook",   "lineIds": [...], "title": string, "chips": [string], "tease": string|null },
  { "kind": "slides", "slides": [ { "lineIds": [...], "topic": string, "points": [string], "image": string|null, "stats": [ { "label": string, "value": number, "prefix": string, "suffix": string } ] } ] },
  { "kind": "web",    "pages":  [ { "lineIds": [...], "url": string, "label": string|null } ] },
  { "kind": "cta",    "lineIds": [...], "keyword": string, "line": string, "follow": string }
] }`;
  const rules = [
    `Sections in this order: hook, slides, web, cta. hook and cta are required; slides and web are optional; each kind at most once.`,
    `Use every line id exactly once, in script order, walking the units hook, slide 1, slide 2, ..., page 1, ..., cta. A unit with no lines is invalid. The hook takes the opening line(s); the cta takes the closing line(s).`,
    `The lineIds decide how long each unit is on screen (the voice reads those lines). Give a slide the lines it illustrates; give a page the line(s) that cite its url.`,
    `Limits, strict: title ≤ ${limits.title} chars; ≤ ${limits.chips} chips of ≤ ${limits.chip} chars; per slide: topic ≤ ${limits.topic} chars, 1–${limits.points} points of ≤ ${limits.point} chars each, ≤ 3 stats; keyword ≤ ${limits.keyword} chars; cta line and follow ≤ ${limits.title} chars; tease ≤ ${limits.title} chars or null; page label ≤ 20 chars. Over the limit is rejected, never truncated.`,
    `A page url must be copied exactly from the sources list; never invent one. A slide image is a source's image url or null. Stats only when a line states a number.`,
    `On-screen copy is written fresh and short; the voice already says the lines, so the screen adds, never repeats. Brand: ${brand.name} (${brand.handle}). Themes available: ${themes.join(', ') || 'default'}.`,
  ].join('\n');
  const errors = input.errors?.length ? `Your previous answer was rejected:\n- ${input.errors.join('\n- ')}\nFix exactly those and answer again.` : '';
  return [`Split this approved reel script into the "tools" template's sections.`, `SCRIPT LINES:\n${lines}`, `SOURCES:\n${sources || '(none)'}`, rules, errors, shape].filter(Boolean).join('\n\n');
}

export const tools: PatternDef = {
  name: 'tools',
  SectionsSchema: ToolsSectionsSchema,
  prompt,
  parse,
  check,
  units,
  // Filled in by lib/reel/pattern/document.ts (Task 6).
  doc: (_input: DocInput): unknown => { throw new Error('tools.doc is wired in document.ts'); },
};
```

(Task 6 replaces the `doc` stub with the real builder; the stub keeps this task compiling.)

- [ ] **Step 5: Write `lib/reel/pattern/index.ts`**

```ts
import { tools } from './tools';
import { templates, ServiceDown, type ServiceOpts, type TemplateInfo } from './service';
import type { PatternDef } from './types';

export const PATTERNS: Record<string, PatternDef> = { tools };

export function patternDef(name: string): PatternDef {
  const def = PATTERNS[name];
  if (!def) throw new Error(`unknown pattern "${name}"; the studio knows ${Object.keys(PATTERNS).join(', ')}`);
  return def;
}

export type AvailablePattern = Pick<TemplateInfo, 'name' | 'displayName' | 'themes' | 'limits' | 'defaults'>;

/**
 * Patterns the studio can offer: known here AND rendered by the service. A template the
 * service does not list is not offered; a service that is down offers nothing.
 */
export async function availablePatterns(opts: ServiceOpts = {}): Promise<AvailablePattern[]> {
  let list: TemplateInfo[];
  try {
    list = await templates(opts);
  } catch (err) {
    if (err instanceof ServiceDown) return [];
    throw err;
  }
  return list.filter((t) => PATTERNS[t.name]).map(({ name, displayName, themes, limits, defaults }) => ({ name, displayName, themes, limits, defaults }));
}

/** The service's word for a pattern's limits and defaults, for callers that already have the list. */
export function templateFor(name: string, list: TemplateInfo[]): TemplateInfo {
  const t = list.find((x) => x.name === name);
  if (!t) throw new ServiceDown(`reels-templates does not list a "${name}" template`);
  return t;
}
export type { PatternDef, Unit, UnitTime, Limits, Brand, CandidateRef, PromptInput, DocInput } from './types';
export { SectionError } from './types';
```

Add to the registry test:

```ts
it('offers only patterns the service also lists', async () => {
  const { availablePatterns } = await import('@/lib/reel/pattern');
  const f = (async () => ({ ok: true, status: 200, json: async () => ({ templates: [{ name: 'tools', displayName: 'Tools', themes: ['kinetic'], limits, defaults: { hook: 10 }, sections: [], required: [], samples: {} }, { name: 'carousel', displayName: 'C', themes: [], limits: {}, defaults: {}, sections: [], required: [], samples: {} }] }) })) as unknown as typeof fetch;
  expect((await availablePatterns({ baseUrl: 'http://t1', fetchImpl: f })).map((p) => p.name)).toEqual(['tools']);
  const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  expect(await availablePatterns({ baseUrl: 'http://t2', fetchImpl: down })).toEqual([]);
});
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.tools.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/types.ts lib/reel/pattern/tools.ts lib/reel/pattern/index.ts tests/reel.pattern.tools.test.ts
git commit -m "feat(reel): pattern registry; the tools pattern's sections, checks and prompt"
```

---

### Task 5: Timing — line spans from the voice, unit seconds, defaults

**Files:**
- Create: `lib/reel/pattern/timing.ts`
- Test: `tests/reel.pattern.timing.test.ts`

**Interfaces:**
- Consumes: `alignScriptWords(beats: {id,text}[], heard: Word[]): AlignedWord[]` from `lib/reel/script-align.ts`; `Unit`, `UnitTime` from `./types`.
- Produces:
  ```ts
  export function lineSpans(script: Script, words: Word[]): Map<string, { start: number; end: number }>;
  export class UnitTooLong extends Error { unit: Unit; sec: number; limit: number }
  export type TimingOpts = { fps: number; secMin: number; secMax: number; leadSec?: number };
  export function unitTimes(units: Unit[], spans: Map<string, {start,end}>, voSec: number, opts: TimingOpts): UnitTime[];
  export function defaultTimes(units: Unit[], defaults: Record<string, number>, opts: { fps: number }): UnitTime[];
  ```

- [ ] **Step 1: Write the failing tests**

`tests/reel.pattern.timing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lineSpans, unitTimes, defaultTimes, UnitTooLong } from '@/lib/reel/pattern/timing';
import { script } from './reel.pattern.tools.test';
import type { Unit } from '@/lib/reel/pattern/types';

/** Words for the whole script, one every 0.4 s from t=0.5, in script order. */
function heard() {
  const words: { w: string; start: number; end: number }[] = [];
  let t = 0.5;
  for (const l of [...script.lines].sort((a, b) => a.order - b.order)) {
    for (const w of l.text.split(/\s+/)) { words.push({ w, start: t, end: t + 0.3 }); t += 0.4; }
    t += 0.4; // a breath between lines
  }
  return words;
}
const units: Unit[] = [
  { path: 'sections.0', label: 'hook', kind: 'hook', lineIds: ['l1'] },
  { path: 'sections.1.slides.0', label: 'slide 1', kind: 'slide', lineIds: ['l2'] },
  { path: 'sections.1.slides.1', label: 'slide 2', kind: 'slide', lineIds: ['l3'] },
  { path: 'sections.2.pages.0', label: 'page 1', kind: 'page', lineIds: ['l4'] },
  { path: 'sections.3', label: 'cta', kind: 'cta', lineIds: ['l5'] },
];
const opts = { fps: 30, secMin: 1, secMax: 30, leadSec: 0.25 };

describe('lineSpans', () => {
  it('gives every line the span of its heard words, in order', () => {
    const spans = lineSpans(script, heard());
    expect([...spans.keys()]).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(spans.get('l1')!.start).toBeCloseTo(0.5, 2);
    expect(spans.get('l2')!.start).toBeGreaterThan(spans.get('l1')!.end);
  });
  it('returns nothing for a reel with no words yet', () => {
    expect(lineSpans(script, []).size).toBe(0);
  });
});

describe('unitTimes', () => {
  it('starts each unit a lead before its first word, the first at zero, the last at the voice end', () => {
    const spans = lineSpans(script, heard());
    const voSec = 20;
    const t = unitTimes(units, spans, voSec, opts);
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBeCloseTo(spans.get('l2')!.start - 0.25, 1);
    expect(t[4].end).toBe(voSec);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeCloseTo(t[i - 1].end, 3);
    for (const u of t) { expect(u.sec).toBeCloseTo(u.end - u.start, 3); expect(Math.round(u.sec * 30)).toBeCloseTo(u.sec * 30, 6); }
  });
  it('never lets a unit go under secMin, pushing the boundary forward', () => {
    const spans = new Map([['l1', { start: 0.2, end: 0.5 }], ['l2', { start: 0.6, end: 1 }], ['l3', { start: 1.1, end: 2 }], ['l4', { start: 2.1, end: 3 }], ['l5', { start: 3.1, end: 4 }]]);
    const t = unitTimes(units, spans, 12, opts);
    for (const u of t) expect(u.sec).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(t.at(-1)!.end).toBe(12);
  });
  it('names a unit that would run past secMax instead of trimming it', () => {
    const spans = lineSpans(script, heard());
    expect(() => unitTimes(units, spans, 200, { ...opts, secMax: 30 })).toThrow(UnitTooLong);
    try { unitTimes(units, spans, 200, { ...opts, secMax: 30 }); } catch (e) { expect((e as UnitTooLong).unit.label).toBe('cta'); expect((e as UnitTooLong).message).toMatch(/cta.*30/); }
  });
  it('falls back to a line share when a line was never heard', () => {
    const spans = lineSpans(script, heard());
    spans.delete('l3');
    const t = unitTimes(units, spans, 20, opts);
    expect(t[2].sec).toBeGreaterThanOrEqual(1);
    expect(t[2].start).toBeGreaterThan(t[1].start);
  });
});

describe('defaultTimes', () => {
  it('uses the template defaults per kind, frame-rounded, back to back', () => {
    const t = defaultTimes(units, { hook: 10, slide: 6, page: 4, cta: 5 }, { fps: 30 });
    expect(t.map((u) => u.sec)).toEqual([10, 6, 6, 4, 5]);
    expect(t.at(-1)!.end).toBe(31);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/reel/pattern/timing.ts`**

```ts
import { alignScriptWords } from '../script-align';
import type { Script } from '../research/script';
import type { Word } from '../schema';
import type { Unit, UnitTime } from './types';

/**
 * The voice is the timing authority. A unit begins a breath before its first line is
 * heard and ends where the next begins; nothing stretches to a floor beyond secMin,
 * because nothing can move the words. Unit boundaries are line boundaries, so a sentence
 * is never cut. `sec` is computed here every time and never stored.
 */

export type Span = { start: number; end: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Where each script line was heard, from the words whisper aligned to the script. */
export function lineSpans(script: Script, words: Word[]): Map<string, Span> {
  const lines = [...script.lines].sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, text: l.text }));
  const spans = new Map<string, Span>();
  const heard = new Set<string>();
  for (const w of alignScriptWords(lines, words)) {
    if (w.heard) heard.add(w.beatId);
    const s = spans.get(w.beatId);
    spans.set(w.beatId, s ? { start: s.start, end: Math.max(s.end, w.end) } : { start: w.start, end: w.end });
  }
  for (const id of [...spans.keys()]) if (!heard.has(id)) spans.delete(id);
  return spans;
}

export class UnitTooLong extends Error {
  constructor(public readonly unit: Unit, public readonly sec: number, public readonly limit: number) {
    super(`${unit.label} needs ${sec.toFixed(1)} s, the template allows ${limit} s; split it or move a line`);
    this.name = 'UnitTooLong';
  }
}

export type TimingOpts = { fps: number; secMin: number; secMax: number; leadSec?: number };

export function unitTimes(units: Unit[], spans: Map<string, Span>, voSec: number, opts: TimingOpts): UnitTime[] {
  if (units.length === 0) return [];
  const lead = opts.leadSec ?? 0.25;
  const grid = (n: number) => Math.round(n * opts.fps) / opts.fps;

  // Where each unit's speech begins: its first heard line, else a share of the reel by lines.
  const totalLines = units.reduce((s, u) => s + u.lineIds.length, 0) || 1;
  let before = 0;
  const starts = units.map((u) => {
    const share = round3((voSec * before) / totalLines);
    before += u.lineIds.length;
    const first = u.lineIds.map((id) => spans.get(id)).find((s): s is Span => Boolean(s));
    return first ? first.start : share;
  });
  for (let k = 1; k < starts.length; k++) if (starts[k] < starts[k - 1]) starts[k] = starts[k - 1];

  const out: UnitTime[] = [];
  let cursor = 0;
  units.forEach((u, k) => {
    const last = k === units.length - 1;
    let end = last ? voSec : round3(starts[k + 1] - lead);
    if (end < cursor + opts.secMin) end = cursor + opts.secMin;
    end = last ? voSec : grid(end);
    if (last && end < cursor + opts.secMin) end = grid(cursor + opts.secMin);
    const sec = round3(end - cursor);
    if (sec > opts.secMax + 1e-6) throw new UnitTooLong(u, sec, opts.secMax);
    out.push({ ...u, start: round3(cursor), end: round3(end), sec });
    cursor = end;
  });
  return out;
}

/** Before the voice exists: the template's defaults per kind, so the layout can be previewed. */
export function defaultTimes(units: Unit[], defaults: Record<string, number>, opts: { fps: number }): UnitTime[] {
  const grid = (n: number) => Math.round(n * opts.fps) / opts.fps;
  let cursor = 0;
  return units.map((u) => {
    const sec = grid(defaults[u.kind] ?? 5);
    const t = { ...u, start: round3(cursor), end: round3(cursor + sec), sec: round3(sec) };
    cursor = round3(cursor + sec);
    return t;
  });
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.timing.test.ts`
Expected: pass. If the "never heard" test fails on `secMin`, the fallback share for `l3` sits between l2 and l4 by construction; check `starts` monotonic fix.

```bash
git add lib/reel/pattern/timing.ts tests/reel.pattern.timing.test.ts
git commit -m "feat(reel): pattern timing — unit seconds measured from the aligned voice"
```

---

### Task 6: The document builder and its hash

**Files:**
- Create: `lib/reel/pattern/document.ts`
- Modify: `lib/reel/pattern/tools.ts` (real `doc`)
- Test: `tests/reel.pattern.document.test.ts`, extend `tests/reel.pattern.tools.test.ts`

**Interfaces:**
- Consumes: `patternDef`, `templateFor`, `templates()`, `lineSpans`, `unitTimes`, `defaultTimes`, `readScript`, `readCandidates`, `loadReel`, `getSettings`, `reelVoFile`, `reelPresenterFile`.
- Produces:
  ```ts
  export function fileUrl(absPath: string): string;                       // 'file:///C:/x/y.mp4'
  export function docHash(doc: unknown): string;                          // textHash(JSON.stringify(doc))
  export type BuiltDocument = { doc: unknown; hash: string; times: UnitTime[]; measured: boolean; presenter: 'upload' | 'lipsync' | null };
  export async function buildDocument(slug: string, opts?: { captions?: boolean } & ServiceOpts): Promise<BuiltDocument>;
  ```

- [ ] **Step 1: Failing tests**

Add to `tests/reel.pattern.tools.test.ts`:

```ts
describe('tools pattern: document', () => {
  it('produces the service shape with measured seconds and file urls only', () => {
    const times = tools.units(good).map((u, i) => ({ ...u, start: i * 5, end: i * 5 + 5, sec: 5 }));
    const doc = tools.doc({
      reel: { ratio: '9:16', fps: 30, pattern: { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null } } as never,
      script, sections: good, times, brand: { handle: '@iolar', name: 'iolar' }, captions: true,
      assets: { vo: 'file:///C:/r/vo.mp3', presenter: 'file:///C:/r/presenter.mp4', words: [{ w: 'three', start: 0, end: 0.3 }] },
    }) as { template: string; theme: string; sections: { kind: string; sec?: number; slides?: { sec: number }[]; pages?: { sec: number }[]; presenter?: string }[]; vo: { file: string; words: unknown[] }; captions: { enabled: boolean }; music: { file: null } };
    expect(doc.template).toBe('tools');
    expect(doc.theme).toBe('kinetic');
    expect(doc.sections.map((s) => s.kind)).toEqual(['hook', 'slides', 'web', 'cta']);
    expect(doc.sections[0]).toMatchObject({ sec: 5, presenter: 'file:///C:/r/presenter.mp4', title: '3 tools nobody told you about' });
    expect(doc.sections[1].slides!.map((s) => s.sec)).toEqual([5, 5]);
    expect(doc.sections[2].pages![0].sec).toBe(5);
    expect(doc.sections[3]).toMatchObject({ kind: 'cta', sec: 5, keyword: 'TOOLS' });
    expect(doc.vo).toEqual({ file: 'file:///C:/r/vo.mp3', words: [{ w: 'three', start: 0, end: 0.3 }] });
    expect(doc.captions.enabled).toBe(true);
    expect(doc.music.file).toBeNull();
    expect(JSON.stringify(doc)).not.toContain('lineIds');
  });
  it('omits vo when there is no voice yet and drops the presenter when none exists', () => {
    const times = tools.units(good).map((u, i) => ({ ...u, start: i * 5, end: i * 5 + 5, sec: 5 }));
    const doc = tools.doc({ reel: { ratio: '9:16', fps: 30, pattern: { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null } } as never, script, sections: good, times, brand: { handle: '@iolar', name: 'iolar' }, captions: false, assets: { vo: null, presenter: null, words: [] } }) as { vo?: unknown; sections: { presenter?: string }[] };
    expect(doc.vo).toBeUndefined();
    expect(doc.sections[0].presenter).toBe('fixture://presenter.mp4');
  });
});
```

`tests/reel.pattern.document.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { script, candidates, good, limits } from './reel.pattern.tools.test';

const templatesReply = { templates: [{ name: 'tools', displayName: 'Tools', sections: ['hook', 'slides', 'web', 'cta'], required: ['hook', 'cta'], defaults: { hook: 10, slide: 6, page: 4, cta: 5 }, limits, themes: ['kinetic'], samples: {} }] };
const fetchTemplates = (async () => ({ ok: true, status: 200, json: async () => templatesReply })) as unknown as typeof fetch;

async function seed(withVoice: boolean) {
  const { createReel, saveReel, loadReel } = await import('@/lib/reel/store');
  const { writeScript, writeCandidates } = await import('@/lib/reel/research/store');
  const { reelDir, reelVoFile } = await import('@/lib/paths');
  await createReel('t', { pattern: { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null } } as never);
  mkdirSync(path.join(reelDir('t'), 'research'), { recursive: true });
  await writeScript('t', script);
  await writeCandidates('t', { runId: 't', candidates: Object.values(candidates).map((c) => ({ ...c, sourceClass: 'web', canonicalUrl: c.url, publisher: 'p', author: null, publishedAt: null, retrievedAt: '2026-09-03T00:00:00.000Z', durationSec: null, summary: 's', pullQuotes: [], stats: [], assetKind: 'doc', scores: { relevance: 5, authority: 5, recency: 5, uniqueness: 5, usability: 5 }, total: 100, verdict: 'keep' })) } as never);
  if (withVoice) {
    writeFileSync(reelVoFile('t'), 'mp3');
    const reel = await loadReel('t');
    let t = 0.5; const words = [] as { w: string; start: number; end: number }[];
    for (const l of script.lines) { for (const w of l.text.split(/\s+/)) { words.push({ w, start: t, end: t + 0.3 }); t += 0.4; } t += 0.4; }
    await saveReel('t', { ...reel, vo: { ...reel.vo, durationSec: 20, words } });
  }
}

describe('buildDocument', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'doc-')); vi.resetModules(); });

  it('uses template defaults before the voice is aligned and says so', async () => {
    await seed(false);
    const { buildDocument } = await import('@/lib/reel/pattern/document');
    const b = await buildDocument('t', { baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(b.measured).toBe(false);
    expect(b.times.map((u) => u.sec)).toEqual([10, 6, 6, 4, 5]);
    expect(b.presenter).toBeNull();
  });

  it('measures from the words, points at vo.mp3 and presenter.mp4 as file urls, and hashes the document', async () => {
    await seed(true);
    const { reelPresenterFile } = await import('@/lib/paths');
    writeFileSync(reelPresenterFile('t'), 'mp4');
    const { buildDocument, docHash } = await import('@/lib/reel/pattern/document');
    const b = await buildDocument('t', { baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(b.measured).toBe(true);
    expect(b.presenter).toBe('upload');
    const doc = b.doc as { vo: { file: string }; sections: { presenter?: string }[] };
    expect(doc.vo.file).toMatch(/^file:\/\/\/.*vo\.mp3$/);
    expect(doc.sections[0].presenter).toMatch(/^file:\/\/\/.*presenter\.mp4$/);
    expect(b.hash).toBe(docHash(b.doc));
    expect(b.times.at(-1)!.end).toBe(20);
  });
});
```

Note: `writeCandidates` validates with the candidates schema; if a required field differs, read `lib/reel/research/candidate.ts` and complete the object accordingly rather than loosening the schema.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.tools.test.ts tests/reel.pattern.document.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `tools.doc` in `lib/reel/pattern/tools.ts`**

Replace the stub:

```ts
function doc(input: DocInput): unknown {
  const { reel, times, brand, captions, assets } = input;
  const sections = input.sections as ToolsSection[];
  const secAt = new Map(times.map((t) => [t.path, t.sec]));
  const sec = (p: string) => secAt.get(p) ?? 5;
  const body = sections.map((s, i) => {
    const at = `sections.${i}`;
    if (s.kind === 'hook') return { kind: 'hook', sec: sec(at), presenter: assets.presenter ?? 'fixture://presenter.mp4', title: s.title, chips: s.chips, tease: s.tease };
    if (s.kind === 'slides') return { kind: 'slides', slides: s.slides.map((sl, j) => ({ sec: sec(`${at}.slides.${j}`), topic: sl.topic, points: sl.points, image: sl.image, stats: sl.stats })) };
    if (s.kind === 'web') return { kind: 'web', pages: s.pages.map((pg, j) => ({ sec: sec(`${at}.pages.${j}`), url: pg.url, label: pg.label })) };
    return { kind: 'cta', sec: sec(at), keyword: s.keyword, line: s.line, follow: s.follow };
  });
  return {
    template: 'tools',
    theme: reel.pattern?.theme ?? 'glass-bento',
    ratio: reel.ratio,
    fps: reel.fps,
    brand: { handle: brand.handle.slice(0, 24), name: brand.name.slice(0, 24) },
    sections: body,
    ...(assets.vo ? { vo: { file: assets.vo, words: assets.words } } : {}),
    captions: { enabled: captions && assets.words.length > 0 },
    music: { file: null, gainDb: -18, duckDb: -12 },
  };
}
```

and set `doc` in the exported `tools` object. The fixture presenter keeps `/validate` useful before a clip exists; `renderPattern` (Task 9) refuses to submit while `presenter` is null.

- [ ] **Step 4: Write `lib/reel/pattern/document.ts`**

```ts
import { promises as fs } from 'fs';
import path from 'path';
import { loadReel } from '../store';
import * as research from '../research/store';
import { getSettings } from '@/lib/settings';
import { reelPresenterFile, reelVoFile } from '@/lib/paths';
import { textHash } from '../script';
import { patternDef, templateFor } from './index';
import { templates, type ServiceOpts } from './service';
import { defaultTimes, lineSpans, unitTimes } from './timing';
import type { CandidateRef, UnitTime } from './types';

/** The service reads every asset by URL; a local file is `file:///C:/...`, never a bare path. */
export function fileUrl(absPath: string): string {
  const p = path.resolve(absPath).replace(/\\/g, '/');
  return p.startsWith('/') ? `file://${p}` : `file:///${p}`;
}

export function docHash(doc: unknown): string {
  return textHash(JSON.stringify(doc));
}

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);

export async function candidateRefs(slug: string): Promise<Record<string, CandidateRef>> {
  const { candidates } = await research.readCandidates(slug).catch(() => ({ candidates: [] as { id: string; url: string; title: string; thumbnailUrl: string | null }[] }));
  return Object.fromEntries(candidates.map((c) => [c.id, { id: c.id, url: c.url, title: c.title, thumbnailUrl: c.thumbnailUrl ?? null }]));
}

export type BuiltDocument = {
  doc: unknown;
  hash: string;
  times: UnitTime[];
  /** True when the seconds came from the aligned voice rather than the template defaults. */
  measured: boolean;
  /** Which clip fills the hook, or null when there is none yet. */
  presenter: 'upload' | 'lipsync' | null;
};

/**
 * The document the service renders from, built fresh from disk every time: sections,
 * the voice and its words, the presenter clip, the brand. Seconds are measured here from
 * the aligned words and never stored.
 */
export async function buildDocument(slug: string, opts: { captions?: boolean } & ServiceOpts = {}): Promise<BuiltDocument> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const def = patternDef(reel.pattern.name);
  const script = await research.readScript(slug);
  const template = templateFor(reel.pattern.name, await templates(opts));
  const units = def.units(reel.pattern.sections);

  const voFile = reelVoFile(slug);
  const hasVo = await exists(voFile);
  const words = reel.vo.words;
  const measured = hasVo && words.length > 0 && reel.vo.durationSec > 0;
  const times = measured
    ? unitTimes(units, lineSpans(script, words), reel.vo.durationSec, { fps: reel.fps, secMin: template.limits.secMin ?? 1, secMax: template.limits.secMax ?? 30 })
    : defaultTimes(units, template.defaults, { fps: reel.fps });

  const uploaded = await exists(reelPresenterFile(slug));
  const hook = reel.pattern.sections.find((s) => (s as { kind?: string }).kind === 'hook') as { assetId?: string } | undefined;
  const lipsyncAsset = hook?.assetId ? reel.assets.find((a) => a.id === hook.assetId && a.status === 'ready') : undefined;
  const presenterPath = uploaded ? reelPresenterFile(slug) : lipsyncAsset ? path.join(path.dirname(reelVoFile(slug)), lipsyncAsset.path) : null;

  const settings = getSettings();
  const brand = { handle: (settings as { handle?: string }).handle ?? `@${settings.brand}`, name: settings.brand };
  const doc = def.doc({
    reel, script, sections: reel.pattern.sections, times, brand,
    captions: opts.captions ?? false,
    assets: { vo: hasVo ? fileUrl(voFile) : null, presenter: presenterPath ? fileUrl(presenterPath) : null, words: words.map((w) => ({ w: w.w, start: w.start, end: w.end })) },
  });
  return { doc, hash: docHash(doc), times, measured, presenter: uploaded ? 'upload' : lipsyncAsset ? 'lipsync' : null };
}
```

Asset paths on `reel.assets` are relative to the reel dir (see `lib/reel/shots.ts:129` `path.join('assets', safe)`); `path.dirname(reelVoFile(slug))` is the reel dir.

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.tools.test.ts tests/reel.pattern.document.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/document.ts lib/reel/pattern/tools.ts tests/reel.pattern.tools.test.ts tests/reel.pattern.document.test.ts
git commit -m "feat(reel): the tools document, built from sections, voice and presenter with measured seconds"
```

---

### Task 7: SECTION stage — Claude writes the sections, checked and retried once

**Files:**
- Create: `lib/reel/pattern/section.ts`
- Test: `tests/reel.pattern.section.test.ts`

**Interfaces:**
- Consumes: `runClaude(prompt, { timeoutMs })` from `lib/ai/claude.ts`; `patternDef`, `templateFor`, `templates`; `candidateRefs` from `./document`; `readScript`; `loadReel`/`saveReel`; `linesText`, `textHash`.
- Produces:
  ```ts
  export type SectionDeps = { ask?: (prompt: string) => Promise<string> } & ServiceOpts;
  export async function sectionReel(slug: string, deps?: SectionDeps): Promise<Reel>;   // throws SectionError after the retry
  export function sectionsHash(script: Script): string;                                 // textHash(linesText(script))
  ```

- [ ] **Step 1: Failing tests**

`tests/reel.pattern.section.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { script, candidates, good, limits } from './reel.pattern.tools.test';

const templatesReply = { templates: [{ name: 'tools', displayName: 'Tools', sections: [], required: [], defaults: { hook: 10, slide: 6, page: 4, cta: 5 }, limits, themes: ['kinetic'], samples: {} }] };
const fetchTemplates = (async () => ({ ok: true, status: 200, json: async () => templatesReply })) as unknown as typeof fetch;

async function seed(status: 'approved' | 'draft' = 'approved') {
  const { createReel } = await import('@/lib/reel/store');
  const { writeScript, writeCandidates } = await import('@/lib/reel/research/store');
  const { reelDir } = await import('@/lib/paths');
  await createReel('t', { pattern: { name: 'tools', theme: 'kinetic' } } as never);
  mkdirSync(path.join(reelDir('t'), 'research'), { recursive: true });
  await writeScript('t', { ...script, status });
  await writeCandidates('t', { runId: 't', candidates: Object.values(candidates).map((c) => ({ ...c, sourceClass: 'web', canonicalUrl: c.url, publisher: 'p', author: null, publishedAt: null, retrievedAt: '2026-09-03T00:00:00.000Z', durationSec: null, summary: 's', pullQuotes: [], stats: [], assetKind: 'doc', scores: { relevance: 5, authority: 5, recency: 5, uniqueness: 5, usability: 5 }, total: 100, verdict: 'keep' })) } as never);
}

describe('sectionReel', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sec-')); vi.resetModules(); });

  it('asks once, stores the sections and the script hash', async () => {
    await seed();
    const { sectionReel, sectionsHash } = await import('@/lib/reel/pattern/section');
    const prompts: string[] = [];
    const ask = async (p: string) => { prompts.push(p); return JSON.stringify({ sections: good }); };
    const reel = await sectionReel('t', { ask, baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('[l1]');
    expect(reel.pattern?.sections).toHaveLength(4);
    expect(reel.pattern?.scriptHash).toBe(sectionsHash(script));
  });

  it('retries once with the complaint quoted, then keeps the good answer', async () => {
    await seed();
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    const bad = structuredClone(good); (bad[0] as { title: string }).title = 'x'.repeat(70);
    const prompts: string[] = [];
    const ask = async (p: string) => { prompts.push(p); return JSON.stringify({ sections: prompts.length === 1 ? bad : good }); };
    const reel = await sectionReel('t', { ask, baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/sections\.0\.title.*60/);
    expect((reel.pattern?.sections[0] as { title: string }).title).toBe('3 tools nobody told you about');
  });

  it('gives up after the second bad answer and leaves the reel as it was', async () => {
    await seed();
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    const { loadReel } = await import('@/lib/reel/store');
    const bad = structuredClone(good); (bad[3] as { lineIds: string[] }).lineIds = [];
    const ask = async () => JSON.stringify({ sections: bad });
    await expect(sectionReel('t', { ask, baseUrl: 'http://x', fetchImpl: fetchTemplates })).rejects.toMatchObject({ name: 'SectionError' });
    expect((await loadReel('t')).pattern?.sections).toEqual([]);
  });

  it('refuses a script that is not approved', async () => {
    await seed('draft');
    const { sectionReel } = await import('@/lib/reel/pattern/section');
    await expect(sectionReel('t', { ask: async () => '', baseUrl: 'http://x', fetchImpl: fetchTemplates })).rejects.toThrow(/approved/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.section.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/reel/pattern/section.ts`**

```ts
import { runClaude } from '@/lib/ai/claude';
import { getSettings } from '@/lib/settings';
import { loadReel, saveReel } from '../store';
import * as research from '../research/store';
import type { Script } from '../research/script';
import type { Reel } from '../schema';
import { linesText, textHash } from '../script';
import { patternDef, templateFor } from './index';
import { templates, type ServiceOpts } from './service';
import { candidateRefs } from './document';
import { SectionError } from './types';

/**
 * SECTION: the approved script becomes the pattern's sections. One model call, checked
 * against the invariant and the service's limits; one retry with the complaint quoted;
 * then the complaint is the answer. The reel is only written on success.
 */

export type SectionDeps = { ask?: (prompt: string) => Promise<string> } & ServiceOpts;

/** The fingerprint sections carry, so an edited script shows as "sections are stale". */
export function sectionsHash(script: Script): string {
  return textHash(linesText(script));
}

export async function sectionReel(slug: string, deps: SectionDeps = {}): Promise<Reel> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const script = await research.readScript(slug);
  if (script.status !== 'approved') throw new Error('the script is not approved yet — sections are cut from words you have signed off');

  const def = patternDef(reel.pattern.name);
  const template = templateFor(reel.pattern.name, await templates(deps));
  const candidates = await candidateRefs(slug);
  const settings = getSettings();
  const brand = { handle: (settings as { handle?: string }).handle ?? `@${settings.brand}`, name: settings.brand };
  const ask = deps.ask ?? ((p: string) => runClaude(p, { timeoutMs: 600_000 }));

  const input = { script, candidates, brand, limits: template.limits, themes: template.themes };
  let sections: unknown[];
  try {
    sections = def.parse(await ask(def.prompt(input)), script, candidates, template.limits);
  } catch (first) {
    if (!(first instanceof SectionError)) throw first;
    const errors = [`${first.path}: ${first.message}`];
    sections = def.parse(await ask(def.prompt({ ...input, errors })), script, candidates, template.limits);
  }

  const next: Reel = { ...reel, pattern: { ...reel.pattern, sections, scriptHash: sectionsHash(script), job: reel.pattern.job } };
  await saveReel(slug, next);
  return next;
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.section.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/section.ts tests/reel.pattern.section.test.ts
git commit -m "feat(reel): SECTION stage — Claude splits the approved script into pattern sections, checked and retried once"
```

---

### Task 8: PRESENT stage — hook clip from lipsync, or an uploaded file

**Files:**
- Create: `lib/reel/pattern/presenter.ts`, `app/api/reel/[slug]/presenter/route.ts`
- Test: `tests/reel.pattern.presenter.test.ts`, `tests/api.reel.pattern.test.ts` (presenter cases; the rest of that file is Task 10)

**Interfaces:**
- Consumes: `videoProvider('lipsync')` (`VideoProvider.available/animate/jobState/collect`), `addAsset`/`updateAsset` from `lib/reel/store.ts`, `run` from `lib/reel/probe.ts` (ffmpeg), `lineSpans` + `unitTimes` via `buildDocument`, `reelPatternHookAudio`, `reelPresenterFile`, `reelAssetsDir`.
- Produces:
  ```ts
  export type PresenterState = { source: 'upload' | 'lipsync'; status: 'none' | 'queued' | 'running' | 'ready' | 'failed'; assetId?: string; error?: string; blocked?: string };
  export async function presenterState(slug: string): Promise<PresenterState>;
  export async function cutHookAudio(slug: string, deps?: { run?: typeof run; templates?: ServiceOpts }): Promise<{ file: string; start: number; end: number }>;
  export async function startPresenter(slug: string, deps?: { provider?: VideoProvider | null; run?: typeof run } & ServiceOpts): Promise<PresenterState>;
  export async function refreshPresenter(slug: string, deps?: { provider?: VideoProvider | null }): Promise<PresenterState>;
  export async function saveUploadedPresenter(slug: string, bytes: Buffer): Promise<void>;   // writes presenter.mp4, sets pattern.presenter = 'upload'
  export async function clearUploadedPresenter(slug: string): Promise<void>;                 // removes it, sets 'lipsync'
  ```

- [ ] **Step 1: Failing tests**

`tests/reel.pattern.presenter.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { script, candidates, good, limits } from './reel.pattern.tools.test';
import type { VideoProvider } from '@/lib/reel/videoProvider';

const templatesReply = { templates: [{ name: 'tools', displayName: 'Tools', sections: [], required: [], defaults: { hook: 10, slide: 6, page: 4, cta: 5 }, limits, themes: ['kinetic'], samples: {} }] };
const fetchTemplates = (async () => ({ ok: true, status: 200, json: async () => templatesReply })) as unknown as typeof fetch;

async function seed() {
  const { createReel, saveReel, loadReel } = await import('@/lib/reel/store');
  const { writeScript, writeCandidates } = await import('@/lib/reel/research/store');
  const { reelDir, reelVoFile } = await import('@/lib/paths');
  const { saveSettings } = await import('@/lib/settings');
  saveSettings({ presenterImage: 'C:/img/face.png' });
  await createReel('t', { pattern: { name: 'tools', theme: 'kinetic', sections: good } } as never);
  mkdirSync(path.join(reelDir('t'), 'research'), { recursive: true });
  await writeScript('t', script);
  await writeCandidates('t', { runId: 't', candidates: Object.values(candidates).map((c) => ({ ...c, sourceClass: 'web', canonicalUrl: c.url, publisher: 'p', author: null, publishedAt: null, retrievedAt: '2026-09-03T00:00:00.000Z', durationSec: null, summary: 's', pullQuotes: [], stats: [], assetKind: 'doc', scores: { relevance: 5, authority: 5, recency: 5, uniqueness: 5, usability: 5 }, total: 100, verdict: 'keep' })) } as never);
  writeFileSync(reelVoFile('t'), 'mp3');
  const reel = await loadReel('t');
  let t = 0.5; const words = [] as { w: string; start: number; end: number }[];
  for (const l of script.lines) { for (const w of l.text.split(/\s+/)) { words.push({ w, start: t, end: t + 0.3 }); t += 0.4; } t += 0.4; }
  await saveReel('t', { ...reel, vo: { ...reel.vo, durationSec: 20, words } });
}

const fakeProvider = (states: string[] = ['running', 'ready']): VideoProvider & { animated: unknown[] } => {
  const p = {
    name: 'lipsync', animated: [] as unknown[],
    async available() { return true; },
    async animate(req: unknown) { p.animated.push(req); return { jobId: 'L1' }; },
    async jobState() { return (states.shift() ?? 'ready') as 'running' | 'ready'; },
    async collect(_id: string, dest: string) { writeFileSync(dest, 'clip'); },
  };
  return p;
};

describe('presenter for a pattern reel', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pres-')); vi.resetModules(); });

  it('cuts the hook span from the voice into pattern/hook.wav', async () => {
    await seed();
    const { cutHookAudio } = await import('@/lib/reel/pattern/presenter');
    const runs: string[][] = [];
    const run = (async (_cmd: string, args: string[]) => { runs.push(args); writeFileSync(args.at(-1)!, 'wav'); return { stdout: '', stderr: '' }; }) as never;
    const cut = await cutHookAudio('t', { run, templates: { baseUrl: 'http://x', fetchImpl: fetchTemplates } });
    expect(cut.file).toMatch(/pattern[\\/]hook\.wav$/);
    expect(cut.start).toBe(0);
    expect(cut.end).toBeGreaterThan(1);
    expect(runs[0]).toContain('-ss');
  });

  it('submits the hook audio to lipsync, records the asset on the hook section, and collects it when ready', async () => {
    await seed();
    const { startPresenter, refreshPresenter, presenterState } = await import('@/lib/reel/pattern/presenter');
    const { loadReel } = await import('@/lib/reel/store');
    const provider = fakeProvider(['running', 'ready']);
    const run = (async (_c: string, args: string[]) => { writeFileSync(args.at(-1)!, 'wav'); return { stdout: '', stderr: '' }; }) as never;
    const started = await startPresenter('t', { provider, run, baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(started.status).toBe('queued');
    expect((provider.animated[0] as { imagePath: string }).imagePath).toBe('C:/img/face.png');
    const hook = (await loadReel('t')).pattern!.sections[0] as { assetId?: string };
    expect(hook.assetId).toBeTruthy();
    expect((await refreshPresenter('t', { provider })).status).toBe('running');
    const done = await refreshPresenter('t', { provider });
    expect(done.status).toBe('ready');
    const reel = await loadReel('t');
    const asset = reel.assets.find((a) => a.id === hook.assetId)!;
    expect(asset.status).toBe('ready');
    expect(existsSync(path.join(process.env.IOLAR_DATA_DIR!, 'reel', 't', asset.path))).toBe(true);
    expect((await presenterState('t')).status).toBe('ready');
  });

  it('is blocked, not failed, when lipsync is down; an upload wins over lipsync', async () => {
    await seed();
    const { startPresenter, presenterState, saveUploadedPresenter, clearUploadedPresenter } = await import('@/lib/reel/pattern/presenter');
    const { loadReel } = await import('@/lib/reel/store');
    const down = { ...fakeProvider(), async available() { return false; } };
    const s = await startPresenter('t', { provider: down, baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(s.status).toBe('none');
    expect(s.blocked).toMatch(/lipsync|upload/);
    await saveUploadedPresenter('t', Buffer.from('mp4'));
    expect((await loadReel('t')).pattern?.presenter).toBe('upload');
    expect(await presenterState('t')).toMatchObject({ source: 'upload', status: 'ready' });
    await clearUploadedPresenter('t');
    expect((await loadReel('t')).pattern?.presenter).toBe('lipsync');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.presenter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `lib/reel/pattern/presenter.ts`**

```ts
import { promises as fs } from 'fs';
import path from 'path';
import { loadReel, saveReel, addAsset, updateAsset } from '../store';
import { run as runProbe } from '../probe';
import { getSettings } from '@/lib/settings';
import { reelAssetsDir, reelDir, reelPatternDir, reelPatternHookAudio, reelPresenterFile } from '@/lib/paths';
import { videoProvider, type VideoProvider } from '../videoProvider';
import '../providers';
import { buildDocument } from './document';
import type { ServiceOpts } from './service';

/**
 * The hook's presenter clip. By default the lipsync desk animates the settings presenter
 * image over the hook's own audio; a clip the user drops at presenter.mp4 wins over that
 * and skips the render. Nothing here trims: the service trims a longer clip from its start.
 */

export type PresenterState = {
  source: 'upload' | 'lipsync';
  status: 'none' | 'queued' | 'running' | 'ready' | 'failed';
  assetId?: string;
  error?: string;
  /** Why the stage cannot proceed; the board shows it and offers the upload. */
  blocked?: string;
};

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);
type HookSection = { kind: 'hook'; assetId?: string } & Record<string, unknown>;
const hookOf = (sections: unknown[]) => sections.find((s) => (s as { kind?: string }).kind === 'hook') as HookSection | undefined;

export async function presenterState(slug: string): Promise<PresenterState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) return { source: 'lipsync', status: 'none', blocked: 'not a pattern reel' };
  if (await exists(reelPresenterFile(slug))) return { source: 'upload', status: 'ready' };
  const hook = hookOf(reel.pattern.sections);
  const asset = hook?.assetId ? reel.assets.find((a) => a.id === hook.assetId) : undefined;
  if (!asset) return { source: 'lipsync', status: 'none' };
  const status = asset.status === 'awaiting-manual' ? 'failed' : asset.status;
  return { source: 'lipsync', status, assetId: asset.id, ...(asset.error ? { error: asset.error } : {}) };
}

/** The hook unit's stretch of the voice, mono 16 kHz as the lipsync encoder reads it. */
export async function cutHookAudio(slug: string, deps: { run?: typeof runProbe; templates?: ServiceOpts } = {}): Promise<{ file: string; start: number; end: number }> {
  const built = await buildDocument(slug, deps.templates);
  if (!built.measured) throw new Error('the voice is not aligned yet, so the hook has no span to cut');
  const hook = built.times.find((u) => u.kind === 'hook');
  if (!hook) throw new Error('the sections have no hook');
  await fs.mkdir(reelPatternDir(slug), { recursive: true });
  const file = reelPatternHookAudio(slug);
  const { reelVoFile } = await import('@/lib/paths');
  await (deps.run ?? runProbe)('ffmpeg', ['-y', '-ss', hook.start.toFixed(3), '-t', Math.max(0.5, hook.end - hook.start).toFixed(3), '-i', reelVoFile(slug), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file]);
  return { file, start: hook.start, end: hook.end };
}

export async function startPresenter(slug: string, deps: { provider?: VideoProvider | null; run?: typeof runProbe } & ServiceOpts = {}): Promise<PresenterState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern`);
  if (await exists(reelPresenterFile(slug))) return { source: 'upload', status: 'ready' };
  const provider = deps.provider === undefined ? videoProvider('lipsync') : deps.provider;
  if (!provider || !(await provider.available())) {
    return { source: 'lipsync', status: 'none', blocked: 'lipsync is down — start it from Plugins, or upload a hook clip' };
  }
  const image = getSettings().presenterImage;
  if (!image) return { source: 'lipsync', status: 'none', blocked: 'no presenter image is set — choose one in settings, or upload a hook clip' };

  const { file, start, end } = await cutHookAudio(slug, { run: deps.run, templates: deps });
  const { jobId } = await provider.animate({ audioPath: file, seconds: end - start, seed: reel.seed, ratio: reel.ratio, fps: reel.fps, brief: 'the hook, spoken to camera', imagePath: image, steps: getSettings().lipsyncSteps });
  const asset = await addAsset(slug, { kind: 'video', path: path.join('assets', 'presenter-hook.mp4'), origin: 'plugin', status: 'queued', provider: provider.name, jobId, brief: 'hook presenter' });
  const fresh = await loadReel(slug);
  const sections = fresh.pattern!.sections.map((s) => ((s as { kind?: string }).kind === 'hook' ? { ...(s as object), assetId: asset.id } : s));
  await saveReel(slug, { ...fresh, pattern: { ...fresh.pattern!, sections } });
  return { source: 'lipsync', status: 'queued', assetId: asset.id };
}

export async function refreshPresenter(slug: string, deps: { provider?: VideoProvider | null } = {}): Promise<PresenterState> {
  const state = await presenterState(slug);
  if (state.source === 'upload' || !state.assetId || (state.status !== 'queued' && state.status !== 'running')) return state;
  const reel = await loadReel(slug);
  const asset = reel.assets.find((a) => a.id === state.assetId)!;
  const provider = deps.provider === undefined ? videoProvider(asset.provider ?? 'lipsync') : deps.provider;
  if (!provider || !asset.jobId) return state;
  const job = await provider.jobState(asset.jobId);
  if (job === 'running') { if (asset.status !== 'running') await updateAsset(slug, asset.id, { status: 'running' }); return { ...state, status: 'running' }; }
  if (job === 'ready') {
    const dest = path.join(reelDir(slug), asset.path);
    await fs.mkdir(reelAssetsDir(slug), { recursive: true });
    await provider.collect(asset.jobId, dest);
    await updateAsset(slug, asset.id, { status: 'ready' });
    return { ...state, status: 'ready' };
  }
  const error = job === 'gone' ? 'the lipsync desk no longer has this job' : 'the lipsync render failed';
  await updateAsset(slug, asset.id, { status: 'failed', error });
  return { ...state, status: 'failed', error };
}

export async function saveUploadedPresenter(slug: string, bytes: Buffer): Promise<void> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern`);
  await fs.mkdir(reelDir(slug), { recursive: true });
  await fs.writeFile(reelPresenterFile(slug), bytes);
  await saveReel(slug, { ...reel, pattern: { ...reel.pattern, presenter: 'upload' } });
}

export async function clearUploadedPresenter(slug: string): Promise<void> {
  const reel = await loadReel(slug);
  await fs.rm(reelPresenterFile(slug), { force: true });
  if (reel.pattern) await saveReel(slug, { ...reel, pattern: { ...reel.pattern, presenter: 'lipsync' } });
}
```

Check `addAsset`'s `NewAsset` type in `lib/reel/store.ts:82` accepts `jobId`, `provider`, `status`; it does (`Omit<ReelAsset, 'id'|'status'|'brief'> & Partial<...>`).

- [ ] **Step 4: Upload route `app/api/reel/[slug]/presenter/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { isSlug, reelPresenterFile } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';
import { clearUploadedPresenter, presenterState, saveUploadedPresenter } from '@/lib/reel/pattern/presenter';

type Ctx = { params: Promise<{ slug: string }> };
const MAX_BYTES = 100 * 1024 * 1024;

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  if (new URL(req.url).searchParams.get('state') !== null) return NextResponse.json(await presenterState(slug));
  try { return await serveMedia(reelPresenterFile(slug), req); } catch { return NextResponse.json({ error: 'no hook clip yet' }, { status: 404 }); }
}

/** The user's own hook clip; it wins over the lipsync render. */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: 'no video in the request body' }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'that clip is too large' }, { status: 413 });
  try {
    await saveUploadedPresenter(slug, bytes);
    return NextResponse.json({ ok: true, bytes: bytes.length });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  await clearUploadedPresenter(slug);
  return NextResponse.json({ ok: true });
}
```

Test cases for `tests/api.reel.pattern.test.ts` (start the file now; Task 10 adds more):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pat-api-')); vi.resetModules(); });

describe('presenter upload', () => {
  it('stores the hook clip for a pattern reel and clears it again', async () => {
    const { createReel, loadReel } = await import('@/lib/reel/store');
    await createReel('t', { pattern: { name: 'tools', theme: 'kinetic' } } as never);
    const r = await import('@/app/api/reel/[slug]/presenter/route');
    const put = await r.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array([1, 2, 3]) }), ctx('t'));
    expect(put.status).toBe(200);
    expect((await loadReel('t')).pattern?.presenter).toBe('upload');
    expect((await (await r.GET(new Request('http://x?state'), ctx('t'))).json())).toMatchObject({ source: 'upload', status: 'ready' });
    expect((await r.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array() }), ctx('t'))).status).toBe(400);
    await r.DELETE(new Request('http://x'), ctx('t'));
    expect((await loadReel('t')).pattern?.presenter).toBe('lipsync');
  });
});
```

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.presenter.test.ts tests/api.reel.pattern.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/presenter.ts "app/api/reel/[slug]/presenter/route.ts" tests/reel.pattern.presenter.test.ts tests/api.reel.pattern.test.ts
git commit -m "feat(reel): PRESENT stage — the hook clip from lipsync over the hook's own audio, or an uploaded file"
```

---

### Task 9: The stage machine — `patternState`, `advancePattern`, `renderPattern`, `pollRender`

**Files:**
- Create: `lib/reel/pattern/run.ts`
- Test: `tests/reel.pattern.run.test.ts`

**Interfaces:**
- Consumes: `sectionReel`, `sectionsHash`, `buildDocument`, `presenterState`, `startPresenter`, `refreshPresenter`, `synthesizeVoice`, `alignExistingVoice`, service `validate/submit/job/download/previewUrl`, `reelVoFile`, `reelExportDir`, `reelPatternTimelineFile`.
- Produces:
  ```ts
  export type PatternStage = 'unsectioned' | 'sectioned' | 'voiced' | 'aligned' | 'presented' | 'rendering' | 'failed' | 'done';
  export type PatternState = {
    stage: PatternStage; blocked: string | null;
    sectionsStale: boolean; renderStale: boolean;        // script changed since sectioned; document changed since submitted
    units: UnitTime[]; measured: boolean; timingError: string | null;
    presenter: PresenterState; job: ReelPattern['job']; previewUrl: string | null; exportPath: string | null;
    lastError: string | null;
  };
  export type RunDeps = SectionDeps & { provider?: VideoProvider | null; run?: typeof runProbe; voice?: 'tts' | 'supplied' };
  export async function patternState(slug: string, deps?: ServiceOpts & { provider?: VideoProvider | null }): Promise<PatternState>;
  export async function advancePattern(slug: string, deps?: RunDeps): Promise<PatternState>;
  export async function renderPattern(slug: string, deps?: ServiceOpts & { captions?: boolean }): Promise<PatternState>;   // validate, submit, record job
  export async function pollRender(slug: string, deps?: ServiceOpts): Promise<PatternState>;                                // mirror job state; download on done
  ```

- [ ] **Step 1: Failing tests**

`tests/reel.pattern.run.test.ts` — reuse the `seed`, `fetchTemplates` helpers by copying them from `tests/reel.pattern.presenter.test.ts` into a shared `tests/helpers/pattern.ts` (export `seedPatternReel(opts: { sections?: boolean; voice?: boolean; words?: boolean; approved?: boolean })`, `fetchTemplates`, `fakeProvider`, `templatesReply`) and import from there in both files.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, fakeProvider, templatesReply } from './helpers/pattern';
import { good } from './reel.pattern.tools.test';

type Route = { status?: number; body?: unknown; bytes?: Uint8Array };
const service = (routes: Record<string, Route | Route[]>) => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => u.endsWith(k) || u.includes(`${k}?`));
    const entry = routes[key ?? ''];
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry ?? { status: 404, body: {} };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {}, text: async () => '', arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};
const base = { baseUrl: 'http://x' };

describe('patternState', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'run-')); vi.resetModules(); });

  it('walks the stages as files appear', async () => {
    const { f } = service({ '/templates': { body: templatesReply }, '/validate': { body: { durationSec: 31 } } });
    const opts = { ...base, fetchImpl: f };
    const { patternState } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({ approved: false });
    expect(await patternState('t', opts)).toMatchObject({ stage: 'unsectioned', blocked: expect.stringMatching(/approved/) });
    await seedPatternReel({});
    expect((await patternState('t', opts)).stage).toBe('unsectioned');
    await seedPatternReel({ sections: true });
    expect((await patternState('t', opts)).stage).toBe('sectioned');
    await seedPatternReel({ sections: true, voice: true });
    expect((await patternState('t', opts)).stage).toBe('voiced');
    await seedPatternReel({ sections: true, voice: true, words: true });
    const aligned = await patternState('t', opts);
    expect(aligned.stage).toBe('aligned');
    expect(aligned.measured).toBe(true);
    const { reelPresenterFile } = await import('@/lib/paths');
    writeFileSync(reelPresenterFile('t'), 'mp4');
    expect((await patternState('t', opts)).stage).toBe('presented');
  });

  it('flags stale sections and a stale render', async () => {
    const { f } = service({ '/templates': { body: templatesReply } });
    const opts = { ...base, fetchImpl: f };
    const { patternState } = await import('@/lib/reel/pattern/run');
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const { writeScript, readScript } = await import('@/lib/reel/research/store');
    await seedPatternReel({ sections: true, voice: true, words: true });
    const reel = await loadReel('t');
    await saveReel('t', { ...reel, pattern: { ...reel.pattern!, job: { id: 'j1', state: 'done', submittedAt: 'x', docHash: 'old', error: null } } });
    const s1 = await patternState('t', opts);
    expect(s1.renderStale).toBe(true);
    const script = await readScript('t');
    await writeScript('t', { ...script, lines: script.lines.map((l) => (l.id === 'l2' ? { ...l, text: 'The first now runs offline.' } : l)) });
    expect((await patternState('t', opts)).sectionsStale).toBe(true);
  });
});

describe('advancePattern and render', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'run-')); vi.resetModules(); });

  it('sections, then refuses to voice without a file when voice is supplied', async () => {
    const { f } = service({ '/templates': { body: templatesReply } });
    const { advancePattern } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({});
    const ask = async () => JSON.stringify({ sections: good });
    expect((await advancePattern('t', { ...base, fetchImpl: f, ask })).stage).toBe('sectioned');
    await expect(advancePattern('t', { ...base, fetchImpl: f, voice: 'supplied' })).rejects.toThrow(/upload/);
  });

  it('starts the presenter at aligned and validates, submits and records the job at presented', async () => {
    const { f, calls } = service({ '/templates': { body: templatesReply }, '/validate': { body: { durationSec: 20 } }, '/jobs': { status: 202, body: { id: 'j9' } } });
    const { advancePattern, patternState } = await import('@/lib/reel/pattern/run');
    const { loadReel } = await import('@/lib/reel/store');
    await seedPatternReel({ sections: true, voice: true, words: true });
    const provider = fakeProvider(['ready']);
    const run = (async (_c: string, args: string[]) => { writeFileSync(args.at(-1)!, 'wav'); return { stdout: '', stderr: '' }; }) as never;
    const after = await advancePattern('t', { ...base, fetchImpl: f, provider, run });
    expect(after.presenter.status).toBe('queued');
    expect(after.stage).toBe('aligned');
    expect((await patternState('t', { ...base, fetchImpl: f, provider })).stage).toBe('presented');   // refresh collected it
    const rendering = await advancePattern('t', { ...base, fetchImpl: f, provider });
    expect(rendering.stage).toBe('rendering');
    expect(calls.map((c) => c.method + ' ' + c.url.replace('http://x', ''))).toEqual(expect.arrayContaining(['POST /validate', 'POST /jobs']));
    const job = (await loadReel('t')).pattern!.job!;
    expect(job).toMatchObject({ id: 'j9', state: 'queued' });
    expect(rendering.previewUrl).toBe('http://x/preview/tools/kinetic?job=j9');
  });

  it('refuses to submit while the presenter is missing', async () => {
    const { f } = service({ '/templates': { body: templatesReply }, '/validate': { body: {} } });
    const { renderPattern } = await import('@/lib/reel/pattern/run');
    await seedPatternReel({ sections: true, voice: true, words: true });
    await expect(renderPattern('t', { ...base, fetchImpl: f })).rejects.toThrow(/presenter|hook clip/);
  });

  it('maps a 422 from validate to the unit path and never creates a job', async () => {
    const { f, calls } = service({ '/templates': { body: templatesReply }, '/validate': { status: 422, body: { detail: [{ loc: ['body', 'sections', 0, 'hook', 'title'], msg: 'too long', type: 'x' }] } } });
    const { renderPattern } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await expect(renderPattern('t', { ...base, fetchImpl: f })).rejects.toMatchObject({ issues: [{ loc: ['sections', 0, 'hook', 'title'] }] });
    expect(calls.some((c) => c.url.endsWith('/jobs'))).toBe(false);
  });

  it('polls the job, downloads the reel on done, and reports failure with its error', async () => {
    const { f } = service({
      '/templates': { body: templatesReply }, '/validate': { body: {} }, '/jobs': { status: 202, body: { id: 'j1' } },
      '/jobs/j1': [{ body: { state: 'rendering', progress: 0.4, error: null, timeline: null } }, { body: { state: 'done', progress: 1, error: null, timeline: { durationSec: 20 } } }],
      '/jobs/j1/reel.mp4': { bytes: new TextEncoder().encode('mp4') },
    });
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile, reelExportDir, reelPatternTimelineFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await renderPattern('t', { ...base, fetchImpl: f });
    expect((await pollRender('t', { ...base, fetchImpl: f })).stage).toBe('rendering');
    const done = await pollRender('t', { ...base, fetchImpl: f });
    expect(done.stage).toBe('done');
    expect(existsSync(path.join(reelExportDir('t'), 'reel.mp4'))).toBe(true);
    expect(existsSync(reelPatternTimelineFile('t'))).toBe(true);
    expect(done.exportPath).toMatch(/reel\.mp4$/);
  });

  it('carries a failed job and its error', async () => {
    const { f } = service({ '/templates': { body: templatesReply }, '/validate': { body: {} }, '/jobs': { status: 202, body: { id: 'j2' } }, '/jobs/j2': { body: { state: 'failed', progress: 0.2, error: 'page did not load: https://x', timeline: null } } });
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    const { reelPresenterFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    await renderPattern('t', { ...base, fetchImpl: f });
    const s = await pollRender('t', { ...base, fetchImpl: f });
    expect(s.stage).toBe('failed');
    expect(s.job?.error).toContain('page did not load');
  });
});
```

`tests/helpers/pattern.ts` is what the presenter and document tests seeded inline; `seedPatternReel` creates reel `t` with `pattern: { name: 'tools', theme: 'kinetic' }`, writes the script (status per `approved`, default true), candidates, `sections: good` when `sections`, `vo.mp3` bytes when `voice`, words + `durationSec: 20` when `words`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.pattern.run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/reel/pattern/run.ts`**

```ts
import { promises as fs } from 'fs';
import path from 'path';
import { loadReel, saveReel } from '../store';
import * as research from '../research/store';
import { reelExportDir, reelPatternDir, reelPatternTimelineFile, reelVoFile } from '@/lib/paths';
import { synthesizeVoice, alignExistingVoice } from '../voice';
import type { ReelPattern } from '../schema';
import type { VideoProvider } from '../videoProvider';
import { run as runProbe } from '../probe';
import { buildDocument } from './document';
import { sectionReel, sectionsHash, type SectionDeps } from './section';
import { presenterState, refreshPresenter, startPresenter, type PresenterState } from './presenter';
import * as service from './service';
import { UnitTooLong } from './timing';
import type { UnitTime } from './types';

/**
 * Approved script to rendered reel, one stage per call, the state derived from disk the
 * way the build board's is: sections on the reel, a voice file, word timings, a presenter
 * clip, a job on the service. Nothing here is stored that the files do not already say,
 * so a closed tab costs nothing and nothing drifts.
 */

export type PatternStage = 'unsectioned' | 'sectioned' | 'voiced' | 'aligned' | 'presented' | 'rendering' | 'failed' | 'done';

export type PatternState = {
  stage: PatternStage;
  blocked: string | null;
  sectionsStale: boolean;
  renderStale: boolean;
  units: UnitTime[];
  measured: boolean;
  timingError: string | null;
  presenter: PresenterState;
  job: ReelPattern['job'];
  previewUrl: string | null;
  exportPath: string | null;
  lastError: string | null;
};

export type RunDeps = SectionDeps & { provider?: VideoProvider | null; run?: typeof runProbe; voice?: 'tts' | 'supplied' };

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);
const exportFile = (slug: string) => path.join(reelExportDir(slug), 'reel.mp4');

export async function patternState(slug: string, deps: service.ServiceOpts & { provider?: VideoProvider | null } = {}): Promise<PatternState> {
  const reel = await loadReel(slug);
  if (!reel.pattern) throw new Error(`${slug} has no pattern; it is a freeform reel`);
  const p = reel.pattern;
  const base = (): PatternState => ({
    stage: 'unsectioned', blocked: null, sectionsStale: false, renderStale: false, units: [], measured: false, timingError: null,
    presenter: { source: 'lipsync', status: 'none' }, job: p.job, previewUrl: null, exportPath: null, lastError: null,
  });

  const script = await research.readScript(slug).catch(() => null);
  if (!script) return { ...base(), blocked: 'no research script yet — write and approve one on the Research tab' };
  if (script.status !== 'approved') return { ...base(), blocked: 'the script is not approved yet' };

  const sectioned = p.sections.length > 0;
  const state = base();
  state.sectionsStale = sectioned && p.scriptHash !== sectionsHash(script);
  if (!sectioned) return state;

  // Timing and staleness of the document come from the same build.
  try {
    const built = await buildDocument(slug, deps);
    state.units = built.times;
    state.measured = built.measured;
    state.renderStale = Boolean(p.job) && p.job!.docHash !== built.hash;
  } catch (err) {
    if (err instanceof UnitTooLong) state.timingError = err.message;
    else if (err instanceof service.ServiceDown) state.blocked = err.message;
    else throw err;
  }

  state.presenter = deps.provider === null ? await presenterState(slug) : await refreshPresenter(slug, { provider: deps.provider });
  state.previewUrl = p.job ? service.previewUrl(p.name, p.theme, p.job.id, deps.baseUrl) : null;
  state.exportPath = (await exists(exportFile(slug))) ? exportFile(slug) : null;

  if (!(await exists(reelVoFile(slug)))) return { ...state, stage: 'sectioned' };
  if (!reel.vo.words.length) return { ...state, stage: 'voiced' };
  if (state.presenter.status !== 'ready') return { ...state, stage: 'aligned', blocked: state.blocked ?? state.presenter.blocked ?? null };
  if (!p.job || state.renderStale) return { ...state, stage: 'presented' };
  if (p.job.state === 'failed') return { ...state, stage: 'failed' };
  if (p.job.state === 'done' && state.exportPath) return { ...state, stage: 'done' };
  return { ...state, stage: 'rendering' };
}

/** One step forward; where it got to. The voice fork is the build board's: tts or supplied. */
export async function advancePattern(slug: string, deps: RunDeps = {}): Promise<PatternState> {
  const state = await patternState(slug, deps);
  switch (state.stage) {
    case 'unsectioned':
      if (state.blocked) throw new Error(state.blocked);
      await sectionReel(slug, deps);
      break;
    case 'sectioned':
      if (deps.voice === 'tts') await synthesizeVoice(slug);
      else throw new Error('no voiceover yet — upload one, or advance with voice=tts to synthesise it here');
      break;
    case 'voiced':
      await alignExistingVoice(slug);
      break;
    case 'aligned': {
      const p = await startPresenter(slug, deps);
      if (p.blocked) return { ...(await patternState(slug, deps)), blocked: p.blocked };
      break;
    }
    case 'presented':
      return renderPattern(slug, deps);
    case 'rendering':
      return pollRender(slug, deps);
    case 'failed':
    case 'done':
      return state;
  }
  return patternState(slug, deps);
}

/** Validate, submit, remember the job. Refuses without a presenter: the service would render a fixture face. */
export async function renderPattern(slug: string, deps: service.ServiceOpts & { captions?: boolean } = {}): Promise<PatternState> {
  const built = await buildDocument(slug, deps);
  if (!built.presenter) throw new Error('no hook clip yet — let lipsync make one, or upload a presenter clip');
  await service.validate(built.doc, deps);
  const { id } = await service.submit(built.doc, deps);
  const reel = await loadReel(slug);
  await saveReel(slug, { ...reel, pattern: { ...reel.pattern!, job: { id, state: 'queued', submittedAt: new Date().toISOString(), docHash: built.hash, error: null } } });
  return patternState(slug, { ...deps, provider: null });
}

/** Mirror the service's word on the job; on done, take the reel and its timeline home. */
export async function pollRender(slug: string, deps: service.ServiceOpts = {}): Promise<PatternState> {
  const reel = await loadReel(slug);
  const job = reel.pattern?.job;
  if (!reel.pattern || !job) return patternState(slug, { ...deps, provider: null });
  const remote = await service.job(job.id, deps);
  const next = { ...job, state: remote.state, error: remote.error };
  if (remote.state === 'done' && !(await exists(exportFile(slug)))) {
    await fs.mkdir(reelPatternDir(slug), { recursive: true });
    await service.download(job.id, exportFile(slug), deps);
    await fs.writeFile(reelPatternTimelineFile(slug), JSON.stringify(remote.timeline ?? {}, null, 2));
  }
  await saveReel(slug, { ...reel, pattern: { ...reel.pattern, job: next } });
  return patternState(slug, { ...deps, provider: null });
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.pattern.run.test.ts tests/reel.pattern.presenter.test.ts tests/reel.pattern.document.test.ts`
Expected: pass.

```bash
git add lib/reel/pattern/run.ts tests/reel.pattern.run.test.ts tests/helpers/pattern.ts tests/reel.pattern.presenter.test.ts tests/reel.pattern.document.test.ts
git commit -m "feat(reel): pattern stage machine — section, voice, align, present, render, poll"
```

---

### Task 10: API routes

**Files:**
- Create: `app/api/reel/patterns/route.ts`, `app/api/reel/[slug]/pattern/route.ts`, `app/api/reel/[slug]/pattern/section/route.ts`, `app/api/reel/[slug]/pattern/advance/route.ts`, `app/api/reel/[slug]/pattern/render/route.ts`
- Modify: `app/api/reel/route.ts` (accept `pattern`)
- Test: `tests/api.reel.pattern.test.ts`

**Interfaces:**
- `GET /api/reel/patterns` → `{ patterns: AvailablePattern[] }`
- `GET /api/reel/[slug]/pattern` → `PatternState & { pattern: ReelPattern }` (polls the job when rendering)
- `POST /api/reel/[slug]/pattern` body `{ theme?, presenter?, sections?, captions? }` → same; sections checked by the def, 400 with `{ error, path }` on a `SectionError`
- `POST .../pattern/section` → runs `sectionReel`; 400 `{ error, path }` on `SectionError`, 409 when the script is not approved
- `POST .../pattern/advance` body `{ voice?: 'tts' | 'supplied' }` → state; 400 on a thrown message
- `POST .../pattern/render` body `{ captions?: boolean }` → state; 422 `{ error, issues }` on `ServiceRejected`; 503 on `ServiceDown`
- `POST /api/reel` body `{ title, style?, pattern?: { name, theme } | null }`

- [ ] **Step 1: Failing tests** (append to `tests/api.reel.pattern.test.ts`)

```ts
import { seedPatternReel, templatesReply } from './helpers/pattern';
import { good } from './reel.pattern.tools.test';

const templatesFetch = (async (url: string) => {
  if (String(url).endsWith('/templates')) return { ok: true, status: 200, json: async () => templatesReply } as Response;
  if (String(url).endsWith('/validate')) return { ok: true, status: 200, json: async () => ({}) } as Response;
  return { ok: false, status: 404, json: async () => ({}) } as Response;
}) as unknown as typeof fetch;

describe('pattern routes', () => {
  beforeEach(() => vi.stubGlobal('fetch', templatesFetch));

  it('creates a pattern reel and lists available patterns', async () => {
    const { POST } = await import('@/app/api/reel/route');
    const res = await POST(new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'Tools week', pattern: { name: 'tools', theme: 'kinetic' } }) }));
    expect((await res.json()).reel.pattern).toMatchObject({ name: 'tools', theme: 'kinetic', presenter: 'lipsync' });
    const list = await (await (await import('@/app/api/reel/patterns/route')).GET()).json();
    expect(list.patterns.map((p: { name: string }) => p.name)).toEqual(['tools']);
  });

  it('reports state, takes section edits, and refuses bad ones with the path', async () => {
    await seedPatternReel({ sections: true });
    const r = await import('@/app/api/reel/[slug]/pattern/route');
    const state = await (await r.GET(new Request('http://x'), ctx('t'))).json();
    expect(state.stage).toBe('sectioned');
    expect(state.units).toHaveLength(5);
    const edited = structuredClone(good); (edited[0] as { title: string }).title = 'Three tools, one afternoon';
    const ok = await r.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ sections: edited, theme: 'kinetic' }) }), ctx('t'));
    expect(ok.status).toBe(200);
    const bad = structuredClone(good); (bad[0] as { title: string }).title = '';
    const rej = await r.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ sections: bad }) }), ctx('t'));
    expect(rej.status).toBe(400);
    expect((await rej.json()).path).toBe('sections.0.title');
  });

  it('advances with a message on refusal, and renders with 422 issues mapped', async () => {
    await seedPatternReel({ sections: true });
    const adv = await import('@/app/api/reel/[slug]/pattern/advance/route');
    const res = await adv.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ voice: 'supplied' }) }), ctx('t'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/upload/);
    vi.stubGlobal('fetch', (async (url: string) => {
      if (String(url).endsWith('/templates')) return { ok: true, status: 200, json: async () => templatesReply } as Response;
      return { ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'sections', 3, 'cta', 'keyword'], msg: 'too long', type: 'x' }] }) } as Response;
    }) as unknown as typeof fetch);
    const { reelPresenterFile } = await import('@/lib/paths');
    const { writeFileSync } = await import('fs');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    const render = await import('@/app/api/reel/[slug]/pattern/render/route');
    const rr = await render.POST(new Request('http://x', { method: 'POST', body: '{}' }), ctx('t'));
    expect(rr.status).toBe(422);
    expect((await rr.json()).issues[0].loc).toEqual(['sections', 3, 'cta', 'keyword']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/api.reel.pattern.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Write the routes**

`app/api/reel/patterns/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { availablePatterns } from '@/lib/reel/pattern';

/** Patterns the studio can offer: known here and rendered by the templates service. */
export async function GET() {
  return NextResponse.json({ patterns: await availablePatterns() });
}
```

`app/api/reel/route.ts` — in `POST`, replace the `createReel` call:

```ts
    const pattern = body.pattern && typeof body.pattern === 'object' && body.pattern.name
      ? { name: String(body.pattern.name), theme: String(body.pattern.theme ?? '') }
      : null;
    if (pattern && !pattern.theme) return NextResponse.json({ error: 'a pattern needs a theme' }, { status: 400 });
    const reel = await createReel(slug, {
      title: title || slug,
      style: body.style ?? s.reelStyle,
      pattern,
      fps: s.reelFps,
      ratio: (body.ratio ?? s.reelRatio) as '9:16' | '4:5' | '1:1',
    } as never);
```

`app/api/reel/[slug]/pattern/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { loadReel, saveReel } from '@/lib/reel/store';
import { patternDef, SectionError } from '@/lib/reel/pattern';
import { patternState, pollRender } from '@/lib/reel/pattern/run';
import { candidateRefs } from '@/lib/reel/pattern/document';
import { templates, templateFor, ServiceDown } from '@/lib/reel/pattern/service';
import * as research from '@/lib/reel/research/store';

type Ctx = { params: Promise<{ slug: string }> };

const failed = (err: unknown) => {
  if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
  if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
  return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
};

/** Where the pattern build is; polls the service while a job is running. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  try {
    const reel = await loadReel(slug);
    if (!reel.pattern) return NextResponse.json({ error: 'not a pattern reel' }, { status: 404 });
    const live = reel.pattern.job && (reel.pattern.job.state === 'queued' || reel.pattern.job.state === 'preparing' || reel.pattern.job.state === 'rendering');
    const state = live ? await pollRender(slug) : await patternState(slug);
    return NextResponse.json({ ...state, pattern: (await loadReel(slug)).pattern });
  } catch (err) {
    return failed(err);
  }
}

/** Edits to the pattern: theme, presenter source, sections (checked by the definition), captions. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { theme?: string; presenter?: 'lipsync' | 'upload'; sections?: unknown[] };
  try {
    const reel = await loadReel(slug);
    if (!reel.pattern) return NextResponse.json({ error: 'not a pattern reel' }, { status: 404 });
    let next = { ...reel.pattern };
    if (typeof body.theme === 'string' && body.theme) next.theme = body.theme;
    if (body.presenter === 'lipsync' || body.presenter === 'upload') next.presenter = body.presenter;
    if (Array.isArray(body.sections)) {
      const def = patternDef(next.name);
      const script = await research.readScript(slug);
      const limits = templateFor(next.name, await templates()).limits;
      const errs = def.check(body.sections, script, await candidateRefs(slug), limits);
      if (errs.length) throw errs[0];
      next = { ...next, sections: def.SectionsSchema.parse(body.sections) };
    }
    await saveReel(slug, { ...reel, pattern: next });
    const state = await patternState(slug, { provider: null });
    return NextResponse.json({ ...state, pattern: next });
  } catch (err) {
    return failed(err);
  }
}
```

`app/api/reel/[slug]/pattern/section/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { sectionReel } from '@/lib/reel/pattern/section';
import { patternState } from '@/lib/reel/pattern/run';
import { SectionError } from '@/lib/reel/pattern';
import { ServiceDown } from '@/lib/reel/pattern/service';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

/** Claude splits the approved script into sections; a rejected answer comes back with its path. */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  try {
    await sectionReel(slug);
    return NextResponse.json(await patternState(slug, { provider: null }));
  } catch (err) {
    if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    const msg = String(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: msg }, { status: /approved/.test(msg) ? 409 : 500 });
  }
}
```

`app/api/reel/[slug]/pattern/advance/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { advancePattern } from '@/lib/reel/pattern/run';
import { SectionError } from '@/lib/reel/pattern';
import { ServiceDown, ServiceRejected } from '@/lib/reel/pattern/service';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { voice?: 'tts' | 'supplied' };
  try {
    return NextResponse.json(await advancePattern(slug, { voice: body.voice === 'tts' ? 'tts' : 'supplied' }));
  } catch (err) {
    if (err instanceof SectionError) return NextResponse.json({ error: err.message, path: err.path }, { status: 400 });
    if (err instanceof ServiceRejected) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
```

`app/api/reel/[slug]/pattern/render/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { renderPattern } from '@/lib/reel/pattern/run';
import { ServiceDown, ServiceRejected } from '@/lib/reel/pattern/service';

type Ctx = { params: Promise<{ slug: string }> };

/** Validate, submit, remember the job — from any stage past presented, so a re-render is one click. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { captions?: boolean };
  try {
    return NextResponse.json(await renderPattern(slug, { captions: body.captions === true }));
  } catch (err) {
    if (err instanceof ServiceRejected) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    if (err instanceof ServiceDown) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/api.reel.pattern.test.ts tests/api.reel.test.ts`
Expected: pass.

```bash
git add app/api/reel/patterns/route.ts "app/api/reel/[slug]/pattern" app/api/reel/route.ts tests/api.reel.pattern.test.ts
git commit -m "feat(reel): pattern routes — list, state, edits, section, advance, render"
```

---

### Task 11: Studio UI — pattern on create, tab fork, the Pattern board

**Files:**
- Create: `components/reel/PatternBoard.tsx`
- Modify: `app/reel/page.tsx` (new-reel modal), `app/reel/[slug]/page.tsx` (tab fork, header tag)
- Test: `tests/reel.patternboard.test.tsx`, extend `tests/reel.page.test.tsx` if it exists (else skip the modal test)

**Interfaces:**
- Consumes: `GET /api/reel/patterns`, `GET/POST /api/reel/[slug]/pattern`, `POST .../pattern/{section,advance,render}`, `PUT/DELETE .../presenter`, `PUT .../vo`; `PatternState` shape from Task 9; section shapes from Task 4.
- Produces: `<PatternBoard slug pattern onChanged />` where `pattern` is `ReelPattern` and `onChanged()` asks the page to reload the reel.

- [ ] **Step 1: Failing component test**

`tests/reel.patternboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { good } from './reel.pattern.tools.test';

const units = [
  { path: 'sections.0', label: 'hook', kind: 'hook', lineIds: ['l1'], start: 0, end: 10, sec: 10 },
  { path: 'sections.1.slides.0', label: 'slide 1', kind: 'slide', lineIds: ['l2'], start: 10, end: 16, sec: 6 },
  { path: 'sections.1.slides.1', label: 'slide 2', kind: 'slide', lineIds: ['l3'], start: 16, end: 22, sec: 6 },
  { path: 'sections.2.pages.0', label: 'page 1', kind: 'page', lineIds: ['l4'], start: 22, end: 26, sec: 4 },
  { path: 'sections.3', label: 'cta', kind: 'cta', lineIds: ['l5'], start: 26, end: 31, sec: 5 },
];
const lines = { l1: 'Three tools nobody told you about.', l2: 'The first runs offline.', l3: 'The second costs nothing.', l4: 'Here is the repo.', l5: 'Comment tools and I will DM you the links.' };
const pattern = { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null };
const state = (over: Record<string, unknown> = {}) => ({
  stage: 'sectioned', blocked: null, sectionsStale: false, renderStale: false, units, measured: false, timingError: null,
  presenter: { source: 'lipsync', status: 'none' }, job: null, previewUrl: null, exportPath: null, lastError: null, pattern, lines,
  limits: { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 }, themes: ['kinetic', 'glass-bento'], ...over,
});

let posted: { url: string; method: string; body: unknown }[] = [];
let current = state();
afterEach(() => cleanup());
beforeEach(() => {
  posted = [];
  current = state();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (init?.method && init.method !== 'GET') {
      posted.push({ url: u, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith('/pattern/render')) return json({ error: 'cta keyword is 14, the limit is 12', issues: [{ loc: ['sections', 3, 'cta', 'keyword'], msg: 'too long' }] }, 422);
      if (u.endsWith('/pattern')) { current = state({ pattern: { ...pattern, ...(init.body ? JSON.parse(String(init.body)) : {}) } }); return json(current); }
      return json(current);
    }
    if (u.endsWith('/pattern')) return json(current);
    return json({ error: 'no route' }, 404);
  });
});

describe('PatternBoard', () => {
  it('draws one card per unit with its lines and live counts, and lets a line move to the next unit', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    render(<PatternBoard slug="t" pattern={pattern as never} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('unit-card')).toHaveLength(5));
    expect(screen.getByText('Three tools nobody told you about.')).toBeTruthy();
    expect(screen.getByTestId('count-sections.0.title').textContent).toBe('29/60');
    fireEvent.click(screen.getByTestId('move-next-sections.0-l1'));   // hook would empty: refused
    expect(posted.filter((p) => p.url.endsWith('/pattern'))).toHaveLength(0);
    fireEvent.click(screen.getByTestId('move-prev-sections.1.slides.1-l3'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/pattern'))).toBe(true));
    const sent = posted.find((p) => p.url.endsWith('/pattern'))!.body as { sections: { slides?: { lineIds: string[] }[] }[] };
    expect(sent.sections[1].slides!.map((s) => s.lineIds)).toEqual([['l2', 'l3'], []].slice(0, 1).concat([]));
  });

  it('marks over-limit copy, blocks Render, and shows the 422 on the unit', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    current = state({ stage: 'presented', measured: true, presenter: { source: 'upload', status: 'ready' } });
    render(<PatternBoard slug="t" pattern={pattern as never} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('render')).toBeTruthy());
    fireEvent.click(screen.getByTestId('render'));
    await waitFor(() => expect(screen.getByText(/cta keyword is 14/)).toBeTruthy());
    expect(screen.getByTestId('unit-card-sections.3').className).toContain('unit-error');
  });

  it('shows the preview iframe for a job and the export when done', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    current = state({ stage: 'done', job: { id: 'j1', state: 'done', submittedAt: 'x', docHash: 'd', error: null }, previewUrl: 'http://x/preview/tools/kinetic?job=j1', exportPath: 'C:/d/reel/t/export/reel.mp4' });
    render(<PatternBoard slug="t" pattern={pattern as never} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('preview-frame')).toBeTruthy());
    expect((screen.getByTestId('preview-frame') as HTMLIFrameElement).src).toBe('http://x/preview/tools/kinetic?job=j1');
    expect(screen.getByText(/export\/reel\.mp4/)).toBeTruthy();
  });
});
```

The first test's last assertion is awkward; write it as: `expect(sent.sections[1].slides!.map((s) => s.lineIds)).toEqual([['l2', 'l3']]);` — moving `l3` back merges it into slide 1 and removes the now-empty slide 2. Use that form.

`GET /api/reel/[slug]/pattern` must also return `lines` (id → text, from the script), `limits` and `themes` (from `templateFor`), so the board renders from one call. Add those three fields in the route from Task 10 (`lines: Object.fromEntries(script.lines.map((l) => [l.id, l.text]))`; on `ServiceDown` send `limits: {}` and `themes: []`) and to `PatternState`'s JSON, not to the `PatternState` type.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/reel.patternboard.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write `components/reel/PatternBoard.tsx`**

```tsx
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Progress, Radio, Select, Space, Steps, Tag, Typography, Upload, Checkbox } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';

/**
 * Approved script to rendered reel through the templates service. The stage is derived on
 * the server from what is on disk; this panel asks where it got to, draws it, and offers
 * the one next step. Sections are edited here, with the service's own limits counted live,
 * and the preview is the service's player, never a second implementation.
 */

type Unit = { path: string; label: string; kind: string; lineIds: string[]; start: number; end: number; sec: number };
type Section = Record<string, unknown> & { kind: string };
type State = {
  stage: 'unsectioned' | 'sectioned' | 'voiced' | 'aligned' | 'presented' | 'rendering' | 'failed' | 'done';
  blocked: string | null; sectionsStale: boolean; renderStale: boolean; units: Unit[]; measured: boolean; timingError: string | null;
  presenter: { source: 'upload' | 'lipsync'; status: string; error?: string; blocked?: string };
  job: { id: string; state: string; error: string | null } | null; previewUrl: string | null; exportPath: string | null; lastError: string | null;
  pattern: { name: string; theme: string; presenter: 'upload' | 'lipsync'; sections: Section[] };
  lines: Record<string, string>; limits: Record<string, number>; themes: string[];
};
type Issue = { loc: (string | number)[]; msg: string };

const STAGES = ['unsectioned', 'sectioned', 'voiced', 'aligned', 'presented', 'rendering', 'failed', 'done'] as const;
const LABELS = ['Section', 'Voice', 'Align', 'Presenter', 'Render', 'Done'];
const NEXT: Record<string, string> = { unsectioned: 'Section the script', sectioned: 'Add the voice', voiced: 'Align the voice', aligned: 'Make the hook clip', presented: 'Render' };

/** A unit path like sections.1.slides.0 → [1, 'slides', 0]; sections.3 → [3]. */
const parsePath = (p: string) => p.split('.').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s)) as (number | string)[];

function unitOf(sections: Section[], path: string): Record<string, unknown> {
  const [i, key, j] = parsePath(path);
  const s = sections[i as number];
  return key ? ((s[key as string] as Record<string, unknown>[])[j as number]) : s;
}

/** Move one line to the neighbouring unit, keeping script order; an emptied slide or page is dropped. */
export function moveLine(sections: Section[], units: Unit[], path: string, lineId: string, dir: -1 | 1): Section[] | null {
  const k = units.findIndex((u) => u.path === path);
  const from = units[k];
  const to = units[k + dir];
  if (!from || !to) return null;
  const isEdge = dir === -1 ? from.lineIds[0] === lineId : from.lineIds.at(-1) === lineId;
  if (!isEdge) return null;
  if (from.lineIds.length === 1 && (from.kind === 'hook' || from.kind === 'cta')) return null;
  const next = structuredClone(sections);
  const src = unitOf(next, from.path) as { lineIds: string[] };
  const dst = unitOf(next, to.path) as { lineIds: string[] };
  src.lineIds = src.lineIds.filter((id) => id !== lineId);
  dst.lineIds = dir === -1 ? [...dst.lineIds, lineId] : [lineId, ...dst.lineIds];
  if (src.lineIds.length === 0) {
    const [i, key, j] = parsePath(from.path);
    const list = next[i as number][key as string] as unknown[];
    list.splice(j as number, 1);
    if (list.length === 0) next.splice(i as number, 1);
  }
  return next;
}

const Count = ({ path, value, limit }: { path: string; value: string; limit: number }) => (
  <Typography.Text type={value.trim().length > limit || value.trim().length === 0 ? 'danger' : 'secondary'} data-testid={`count-${path}`} style={{ fontSize: 12 }}>
    {value.trim().length}/{limit}
  </Typography.Text>
);

export default function PatternBoard({ slug, pattern, onChanged }: { slug: string; pattern: { name: string; theme: string }; onChanged?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Section[] | null>(null);
  const [voice, setVoice] = useState<'tts' | 'supplied'>('tts');
  const [captions, setCaptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/pattern`, { cache: 'no-store' });
    if (r.ok) { const s = (await r.json()) as State; setState(s); setDraft(s.pattern.sections); }
  }, [slug]);
  useEffect(() => { load(); return () => { if (polling.current) clearInterval(polling.current); }; }, [load]);
  useEffect(() => {
    if (state?.stage !== 'rendering') return;
    polling.current = setInterval(load, 5000);
    return () => { if (polling.current) clearInterval(polling.current); };
  }, [state?.stage, load]);

  const call = async (path: string, body: unknown) => {
    setBusy(true); setError(null); setIssues([]);
    try {
      const r = await fetch(`/api/reel/${slug}/pattern${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'the step did not go through'); if (Array.isArray(d.issues)) setIssues(d.issues); if (d.path) setIssues([{ loc: d.path.split('.'), msg: d.error }]); }
      else { setState(d); setDraft(d.pattern?.sections ?? null); }
    } catch { setError('the studio did not answer — reloading where it got to'); }
    finally { setBusy(false); await load(); onChanged?.(); }
  };

  const save = (sections: Section[]) => call('', { sections });
  const edit = (path: string, field: string, value: unknown) => {
    if (!draft) return;
    const next = structuredClone(draft);
    (unitOf(next, path) as Record<string, unknown>)[field] = value;
    setDraft(next);
  };
  const uploadPresenter = async (file: File) => {
    setBusy(true);
    try { await fetch(`/api/reel/${slug}/presenter`, { method: 'PUT', body: await file.arrayBuffer() }); } finally { setBusy(false); await load(); }
  };
  const uploadVoice = async (file: File) => {
    setBusy(true);
    try { await fetch(`/api/reel/${slug}/vo`, { method: 'PUT', body: await file.arrayBuffer() }); setVoice('supplied'); } finally { setBusy(false); await load(); }
  };

  if (!state || !draft) return null;
  const step = Math.min(STAGES.indexOf(state.stage), LABELS.length - 1);
  const errorAt = (path: string) => issues.some((i) => i.loc.join('.').startsWith(parsePath(path).length ? `sections.${parsePath(path).join('.')}` : path) || i.loc.join('.') === path);
  const total = state.units.at(-1)?.end ?? 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.pattern.sections);
  const L = state.limits;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Steps size="small" current={state.stage === 'failed' ? 4 : step} status={state.stage === 'failed' ? 'error' : undefined} items={LABELS.map((title) => ({ title }))} />
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}
      {state.blocked && <Alert type="warning" showIcon message={state.blocked} />}
      {state.sectionsStale && <Alert type="warning" showIcon message="The script changed since these sections were cut" action={<Button size="small" onClick={() => call('/section', {})}>Re-section</Button>} />}
      {state.renderStale && state.job && <Alert type="info" showIcon message="The document changed since the last render" />}
      {state.timingError && <Alert type="error" showIcon message={state.timingError} />}

      <Card size="small" title="Theme and voice" extra={NEXT[state.stage] ? <Button type="primary" loading={busy} onClick={() => call('/advance', { voice })}>{NEXT[state.stage]}</Button> : <Tag color={state.stage === 'done' ? 'green' : state.stage === 'failed' ? 'red' : 'blue'}>{state.stage}</Tag>}>
        <Space wrap>
          <Select value={state.pattern.theme} style={{ minWidth: 180 }} options={state.themes.map((t) => ({ value: t, label: t }))} onChange={(theme) => call('', { theme })} data-testid="theme" />
          <Radio.Group value={voice} onChange={(e) => setVoice(e.target.value)}>
            <Radio.Button value="tts">Speak it here</Radio.Button>
            <Radio.Button value="supplied">I recorded it</Radio.Button>
          </Radio.Group>
          {voice === 'supplied' && state.stage === 'sectioned' && (
            <Upload accept="audio/*" showUploadList={false} beforeUpload={(f) => { uploadVoice(f as unknown as File); return false; }}><Button icon={<InboxOutlined />}>Drop the voiceover</Button></Upload>
          )}
          <Checkbox checked={captions} onChange={(e) => setCaptions(e.target.checked)}>Captions</Checkbox>
          <Button icon={<ReloadOutlined />} loading={busy} onClick={() => call('/section', {})}>Re-section with Claude</Button>
        </Space>
      </Card>

      <Card size="small" title={`Timing — ${total.toFixed(1)} s${state.measured ? '' : ' (defaults until the voice is aligned)'}`}>
        <div style={{ display: 'flex', width: '100%', height: 22, gap: 2 }} data-testid="timing">
          {state.units.map((u) => (
            <div key={u.path} title={`${u.label} ${u.sec.toFixed(1)}s`} style={{ flex: u.sec, background: errorAt(u.path) ? '#ff4d4f' : u.kind === 'hook' ? '#722ed1' : u.kind === 'cta' ? '#13c2c2' : u.kind === 'page' ? '#1677ff' : '#52c41a', color: '#fff', fontSize: 11, padding: '2px 4px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {u.label} {u.sec.toFixed(1)}s
            </div>
          ))}
        </div>
      </Card>

      {state.units.map((u) => {
        const s = unitOf(draft, u.path) as Record<string, unknown>;
        const text = (f: string, limit: number, rows = 1) => (
          <div>
            <Input.TextArea autoSize={{ minRows: rows }} value={String(s[f] ?? '')} onChange={(e) => edit(u.path, f, e.target.value)} placeholder={f} />
            <Count path={`${u.path}.${f}`} value={String(s[f] ?? '')} limit={limit} />
          </div>
        );
        const list = (f: string, max: number, each: number) => (
          <div>
            {((s[f] as string[]) ?? []).map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Input value={v} onChange={(e) => edit(u.path, f, (s[f] as string[]).map((x, k) => (k === i ? e.target.value : x)))} />
                <Count path={`${u.path}.${f}.${i}`} value={v} limit={each} />
                <Button size="small" onClick={() => edit(u.path, f, (s[f] as string[]).filter((_, k) => k !== i))}>×</Button>
              </div>
            ))}
            {((s[f] as string[]) ?? []).length < max && <Button size="small" onClick={() => edit(u.path, f, [...((s[f] as string[]) ?? []), ''])}>+ {f.slice(0, -1)}</Button>}
          </div>
        );
        return (
          <Card key={u.path} size="small" className={errorAt(u.path) ? 'unit-error' : ''} data-testid={`unit-card-${u.path}`} title={<span data-testid="unit-card">{u.label} · {u.sec.toFixed(1)} s</span>}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {u.lineIds.map((id) => (
                <Tag key={id}>
                  <Button size="small" type="text" icon={<ArrowLeftOutlined />} data-testid={`move-prev-${u.path}-${id}`} onClick={() => { const n = moveLine(draft, state.units, u.path, id, -1); if (n) save(n); }} />
                  {state.lines[id] ?? id}
                  <Button size="small" type="text" icon={<ArrowRightOutlined />} data-testid={`move-next-${u.path}-${id}`} onClick={() => { const n = moveLine(draft, state.units, u.path, id, 1); if (n) save(n); }} />
                </Tag>
              ))}
            </div>
            {u.kind === 'hook' && (<Space orientation="vertical" style={{ width: '100%' }}>{text('title', L.title)}{list('chips', L.chips, L.chip)}{text('tease', L.title)}</Space>)}
            {u.kind === 'slide' && (<Space orientation="vertical" style={{ width: '100%' }}>{text('topic', L.topic)}{list('points', L.points, L.point)}<Input value={String(s.image ?? '')} placeholder="image url or empty" onChange={(e) => edit(u.path, 'image', e.target.value || null)} /></Space>)}
            {u.kind === 'page' && (<Space orientation="vertical" style={{ width: '100%' }}><Input value={String(s.url ?? '')} onChange={(e) => edit(u.path, 'url', e.target.value)} />{text('label', 20)}</Space>)}
            {u.kind === 'cta' && (<Space orientation="vertical" style={{ width: '100%' }}>{text('keyword', L.keyword)}{text('line', L.title)}{text('follow', L.title)}</Space>)}
          </Card>
        );
      })}
      {dirty && <Button type="primary" loading={busy} onClick={() => save(draft)} data-testid="save-sections">Save sections</Button>}

      <Card size="small" title="Presenter">
        <Space wrap>
          <Tag color={state.presenter.status === 'ready' ? 'green' : state.presenter.status === 'failed' ? 'red' : 'blue'}>{state.presenter.source} · {state.presenter.status}</Tag>
          {state.presenter.error && <Typography.Text type="danger">{state.presenter.error}</Typography.Text>}
          <Upload accept="video/*,.mp4,.mov,.webm" showUploadList={false} beforeUpload={(f) => { uploadPresenter(f as unknown as File); return false; }}><Button icon={<InboxOutlined />}>Upload a hook clip</Button></Upload>
          {state.presenter.source === 'upload' && <Button onClick={async () => { await fetch(`/api/reel/${slug}/presenter`, { method: 'DELETE' }); await load(); }}>Use lipsync instead</Button>}
        </Space>
      </Card>

      <Card size="small" title="Render" extra={<Button type="primary" loading={busy} disabled={!['presented', 'failed', 'done'].includes(state.stage) || Boolean(state.timingError)} onClick={() => call('/render', { captions })} data-testid="render">{state.job ? 'Render again' : 'Render'}</Button>}>
        {state.job && <Space orientation="vertical" style={{ width: '100%' }}>
          <Tag>{state.job.id} · {state.job.state}</Tag>
          {state.stage === 'rendering' && <Progress percent={50} status="active" />}
          {state.job.error && <Alert type="error" showIcon message={state.job.error} />}
          {state.previewUrl && <>
            <iframe title="preview" src={state.previewUrl} data-testid="preview-frame" style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: 640, border: 0 }} />
            <a href={state.previewUrl} target="_blank" rel="noreferrer">open the preview in a tab</a>
          </>}
          {state.exportPath && <Typography.Text>Exported to <code>{state.exportPath.replace(/\\/g, '/').replace(/.*\/reel\//, '')}</code></Typography.Text>}
        </Space>}
      </Card>
    </Space>
  );
}
```

Progress: the state route can return `progress` from `pollRender` (`remote.progress`); add `progress: number | null` to `PatternState`, set in `pollRender`, and use `Math.round(progress * 100)` in the `Progress` element instead of the constant 50.

- [ ] **Step 4: New-reel modal and tab fork**

`app/reel/page.tsx`: state `const [patterns, setPatterns] = useState<{ name: string; displayName: string; themes: string[] }[]>([]);`, `const [patternName, setPatternName] = useState<string>('');`, `const [theme, setTheme] = useState<string>('');`; load `fetch('/api/reel/patterns')` next to styles; in the modal, above the Style select:

```tsx
<Select
  value={patternName}
  onChange={(v) => { setPatternName(v); setTheme(patterns.find((p) => p.name === v)?.themes[0] ?? ''); }}
  options={[{ value: '', label: 'Freeform (beats)' }, ...patterns.map((p) => ({ value: p.name, label: `Pattern: ${p.displayName}` }))]}
  data-testid="pattern-pick"
/>
{patternName && (
  <Select value={theme} onChange={setTheme} options={(patterns.find((p) => p.name === patternName)?.themes ?? []).map((t) => ({ value: t, label: t }))} data-testid="theme-pick" />
)}
{patterns.length === 0 && <Typography.Text type="secondary">Patterns appear when reels-templates is running (Plugins).</Typography.Text>}
```

and `body: JSON.stringify({ title, style, pattern: patternName ? { name: patternName, theme } : null })`. A pattern reel skips the plan call: after create, if `patternName` is set, `router.push` straight to the reel (the script comes from Research).

`app/reel/[slug]/page.tsx`: import `PatternBoard`; compute `const patterned = Boolean(reel.pattern);` and build `items` as today, then `.filter((t) => !patterned || ['research', 'voice', 'pattern', 'files'].includes(t.key))`, inserting after `voice`:

```tsx
...(patterned ? [{
  key: 'pattern',
  label: `Pattern: ${reel.pattern!.name}`,
  children: (
    <Card size="small">
      <PatternBoard slug={slug} pattern={reel.pattern!} onChanged={async () => {
        const r = await fetch(`/api/reel/${slug}`).then((x) => x.json()).catch(() => null);
        if (r?.reel) setReel(r.reel as Reel);
      }} />
    </Card>
  ),
}] : []),
```

Header tags: `<Tag>{reel.style}</Tag>` and, when patterned, `<Tag color="purple">{reel.pattern!.name} · {reel.pattern!.theme}</Tag>`. Default tab for a pattern reel stays `research`.

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run tests/reel.patternboard.test.tsx tests/reel.player.test.tsx && npx eslint components/reel/PatternBoard.tsx app/reel`
Expected: pass; lint no new errors.

```bash
git add components/reel/PatternBoard.tsx app/reel/page.tsx "app/reel/[slug]/page.tsx" "app/api/reel/[slug]/pattern/route.ts" lib/reel/pattern/run.ts tests/reel.patternboard.test.tsx
git commit -m "feat(reel): Pattern tab — sections editor with live limits, timing strip, presenter, render and the service preview"
```

---

### Task 12: Whole suite, opt-in end-to-end, docs

**Files:**
- Create: `tests/reel.pattern.e2e.test.ts`
- Modify: `docs/STATE.md`, `docs/handbooks/reels-engine-handbook.html` (one section), `README.md` (one paragraph)

- [ ] **Step 1: Opt-in end-to-end against the live service**

`tests/reel.pattern.e2e.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel } from './helpers/pattern';

const live = process.env.RUN_E2E === '1';

describe.skipIf(!live)('pattern reel end to end (RUN_E2E=1, reels-templates on 26200)', () => {
  beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'e2e-')); });

  it('validates, renders and brings the mp4 home', async () => {
    await seedPatternReel({ sections: true, voice: false, words: false });
    // Real bytes: the service decodes them. Use the bundled fixtures via the sample document if no clip is at hand.
    const { reelPresenterFile, reelVoFile, reelExportDir } = await import('@/lib/paths');
    const clip = process.env.E2E_PRESENTER; const vo = process.env.E2E_VO;
    if (!clip || !vo) throw new Error('set E2E_PRESENTER and E2E_VO to an mp4 and an mp3 on disk');
    writeFileSync(reelPresenterFile('t'), (await import('fs')).readFileSync(clip));
    writeFileSync(reelVoFile('t'), (await import('fs')).readFileSync(vo));
    const { alignExistingVoice } = await import('@/lib/reel/voice');
    await alignExistingVoice('t');
    const { renderPattern, pollRender } = await import('@/lib/reel/pattern/run');
    let s = await renderPattern('t');
    expect(s.stage).toBe('rendering');
    for (let i = 0; i < 120 && s.stage === 'rendering'; i++) { await new Promise((r) => setTimeout(r, 5000)); s = await pollRender('t'); }
    expect(s.stage).toBe('done');
    expect(existsSync(path.join(reelExportDir('t'), 'reel.mp4'))).toBe(true);
  }, 900_000);
});
```

- [ ] **Step 2: Run the whole suite and typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: everything green (the e2e file is skipped without `RUN_E2E`). Fix any test that still says `pattern` for the style.

- [ ] **Step 3: Docs**

`docs/STATE.md`: a "Reel patterns (3 Sep 2026)" section: what `reel.pattern` is, the rename to `style`, the stage list, the routes, "the service on 26200 must be running (Plugins card)", and the `RUN_E2E=1 E2E_PRESENTER=... E2E_VO=...` line.

`docs/handbooks/reels-engine-handbook.html`: one section "Pattern reels" next to the Build section: pick a pattern on create, Research → approve, Pattern tab steps, drop a hook clip or let lipsync make one, Render, preview, export.

`README.md`: one paragraph under the reel engine: pattern reels render through `main-reels-templates-plugin`; freeform reels unchanged.

- [ ] **Step 4: Commit**

```bash
git add tests/reel.pattern.e2e.test.ts docs/STATE.md docs/handbooks/reels-engine-handbook.html README.md
git commit -m "docs(reel): pattern reels — state, handbook, readme; opt-in end-to-end test"
```

---

## Self-review against the spec

- §1 rename → Task 1. `reel.pattern` block → Task 2. Registry and `tools` sections/invariant/limits from the service → Task 4 (limits passed in from `templates()` at call sites in Tasks 6, 7, 10).
- §2 stages and `advance` → Task 9; SECTION with retry → Task 7; VOICE/ALIGN fork on script lines → Task 2; PRESENT → Task 8; RENDER/poll/download → Task 9; timing rules → Task 5; staleness hashes → Tasks 7 (`scriptHash`) and 9 (`docHash`).
- §3 presenter upload route → Task 8; slide images → the prompt offers candidate thumbnail urls and the check accepts any http(s) url or null (the spec's "evidence image asset" does not exist in research; the spec is amended to candidate thumbnails); web urls verbatim from candidates → Task 4 check; document shape and `file://` → Task 6; service client and plugin card → Task 3.
- §4 modal, tab fork, board (steps, theme, cards with counts and line moves, timing strip, presenter row, render row with iframe) → Task 11; routes → Task 10.
- §5 errors: SectionError paths (4, 7, 10), UnitTooLong (5, 9), ServiceDown/ServiceRejected mapping (3, 9, 10), lipsync blocked (8, 9), staleness flags (9, 11).
- §6 tests: schema (1, 2), tools (4, 6), timing (5), run (9), service (3), api (8, 10), board (11), rename sweep (1), e2e (12).

Type consistency checked: `PatternDef.check/parse/units/doc`, `UnitTime`, `PatternState`, `PresenterState`, `ServiceOpts`, `SectionDeps`, `RunDeps` are used with the same names and shapes across tasks. `patternState`'s `progress` field is added in Task 11 step 3 note; add it to the type in Task 9 when implementing.
