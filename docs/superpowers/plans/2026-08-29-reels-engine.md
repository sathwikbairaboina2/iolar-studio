# Reels Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `reel` category — an autonomous vertical-video engine that turns a script into a finished Instagram Reel: TTS voiceover, word-aligned karaoke captions, ComfyUI/Higgsfield-generated shots, a live browser studio for minimal edits, and an ffmpeg export.

**Architecture:** Six re-runnable stages (PLAN, VOICE, SHOTS, ASSEMBLE, STUDIO, EXPORT) over one JSON file per reel. Word-level timestamps from faster-whisper are the timing authority for both captions and cuts. The studio previews the timeline in the DOM (instant scrub) while ffmpeg exports the same timeline; parity is guaranteed by sharing one stylesheet, one motion module, and one timeline resolver between the two.

**Tech Stack:** Next.js 16.3.3 (App Router), React 19, antd 6, zod 4, vitest 4 (jsdom), Playwright chromium, ffmpeg 9.0.1 CLI, faster-whisper (Python, CUDA), ComfyUI HTTP API on 127.0.0.1:8188, Higgsfield via the `claude` CLI's MCP tools.

**Spec:** `docs/superpowers/specs/2026-08-29-iolar-reels-engine-design.md`

## Global Constraints

- **Next.js version is 16.3.3 and differs from training data.** Before writing any route or page, read the relevant guide in `node_modules/next/dist/docs/` (per `AGENTS.md`). Route context params are a Promise: `type Ctx = { params: Promise<{ slug: string }> }`, awaited inside the handler.
- **Data root** is `process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data')`. Never hardcode a data path; always go through `lib/paths.ts`.
- **Every path helper lives in `lib/paths.ts`** — the existing file states the layout once. Reel paths are added there, not to a second module.
- **Text is never rendered by diffusion.** Captions and titles are HTML/CSS in both preview and export.
- **Determinism:** given the same `reel.json`, pattern and seed, ASSEMBLE must produce an identical timeline. Randomness only through `mulberry32` from `lib/rng.ts`.
- **Tests:** `npm test` (vitest, jsdom environment, `@` aliased to the repo root). Tests that touch the filesystem set `process.env.IOLAR_DATA_DIR` to a fresh `mkdtempSync` dir in `beforeEach`, and import modules with dynamic `await import('@/lib/...')` inside the test body so the env var is read after it is set. Follow `tests/store.test.ts`.
- **Windows:** paths use `path.join`; any spawned CLI on win32 uses `shell: true` only where the existing code does (`lib/ai/claude.ts`). `ffmpeg`, `ffprobe` and `python` are real `.exe` files and must be spawned **without** `shell: true`.
- **External services degrade, never crash:** no ComfyUI, no Higgsfield, no whisper — the app still loads, the studio still plays what exists. Follow `getStats()` in `lib/comfy/client.ts` for the pattern.
- **Brand** default is `iolar`; reel default ratio `9:16` (1080x1920), default fps 30.
- **Commit after every task** with a `feat:` / `test:` / `chore:` prefix, as the existing history does.

---

## File Structure

**New — data layer**

| File | Responsibility |
|---|---|
| `lib/reel/schema.ts` | zod schema and types for `reel.json`; `validateReel`; `REEL_RATIOS` |
| `lib/reel/store.ts` | create/load/save/list reels, asset append and status update |
| `lib/paths.ts` (modify) | reel path helpers alongside the handbook ones |

**New — pure engine (no I/O, no network)**

| File | Responsibility |
|---|---|
| `lib/reel/patterns.ts` | load `patterns/<name>/pattern.json`, validate, list |
| `lib/reel/motion.ts` | one motion spec → CSS transform (preview) **and** ffmpeg zoompan (export) |
| `lib/reel/timeline.ts` | "what is on screen at time t" for preview and export |
| `lib/reel/assemble.ts` | words + pattern + seed → clips, captions, overlays; preserves locks |

**New — external adapters**

| File | Responsibility |
|---|---|
| `lib/reel/align.ts` | faster-whisper wrapper → word timestamps |
| `lib/higgsfield/client.ts` | Higgsfield calls through the `claude` CLI's MCP tools |
| `lib/comfy/i2v.ts` | ComfyUI image-to-video: still → short clip |
| `lib/reel/probe.ts` | ffprobe/ffmpeg process helpers (duration, dimensions, scene cuts) |

**New — render/export**

| File | Responsibility |
|---|---|
| `lib/reel/overlays.ts` | Playwright renders caption/overlay PNGs from the pattern CSS |
| `lib/reel/ffmpeg.ts` | timeline → filter graph → encoded mp4, with progress |
| `lib/reel/clone.ts` | reference reel → draft pattern |

**New — routes and UI**

| File | Responsibility |
|---|---|
| `app/api/reel/route.ts` | list + create |
| `app/api/reel/[slug]/route.ts` | get, save, delete |
| `app/api/reel/[slug]/{plan,voice,shots,assemble,export,assets}/route.ts` | one stage each |
| `app/api/reel/patterns/route.ts`, `app/api/reel/patterns/clone/route.ts` | pattern list, clone importer |
| `app/reel/page.tsx`, `app/reel/[slug]/page.tsx` | list, studio |
| `components/reel/{Player,Timeline,ClipPanel,CaptionPanel,ShotQueue}.tsx` | studio UI |
| `patterns/armand/{pattern.json,caption.css,hook.html}` | first creator preset |
| `scripts/setup-whisper.mjs` | one-shot faster-whisper install into a venv |

**Modified:** `lib/paths.ts`, `lib/settings.ts`, `components/AppShell.tsx`, `app/reels/page.tsx`, `app/dashboard/page.tsx`, `lib/db.ts`, `lib/graph.ts`.

---

## Task 0: Spike — can the app reach Higgsfield and whisper?

Two external dependencies are assumed by the spec but unproven from inside a Next.js server process. Find out before any code depends on them. **This task is throwaway** — its output is an answer written into the plan, not code that ships.

**Files:**
- Create (throwaway): `scratch/spike-hf.mjs`, `scratch/spike-whisper.mjs`

- [ ] **Step 1: Probe the Higgsfield path**

The app cannot call MCP tools directly — MCP tools belong to a Claude session, not to a Node server. The proposed bridge is the `claude` CLI, which the app already shells out to in `lib/ai/claude.ts`. Verify it headlessly:

```bash
claude -p --output-format text --allowedTools "mcp__claude_ai_Higgsfield__balance" <<< "Call the Higgsfield balance tool and print only its JSON result."
```

Expected: JSON with a credit balance. Record the exact tool names that resolve.

- [ ] **Step 2: Record the verdict**

- If it works: `lib/higgsfield/client.ts` (Task 9) shells out through `runClaude` with `allowedTools`.
- If it does not: **fall back to agent-in-the-loop** — the app writes a `assets/<id>.request.json` describing the wanted shot or VO, marks the asset `status: "awaiting-manual"`, and the studio shows a "generate this in Claude, then drop the file" card. `POST /api/reel/[slug]/assets` already accepts the drop. No other task changes.

Write the answer into this plan under Task 9 before starting Task 9.

- [ ] **Step 3: Probe whisper**

```bash
python -m venv .venv-whisper
.venv-whisper/Scripts/python -m pip install -q faster-whisper
.venv-whisper/Scripts/python -c "from faster_whisper import WhisperModel; m=WhisperModel('tiny', device='cuda', compute_type='float16'); print('cuda ok')"
```

Expected: `cuda ok`. If CUDA fails, record `device='cpu', compute_type='int8'` as the fallback and note that `large-v3` is then too slow — use `small`.

- [ ] **Step 4: Delete the scratch directory**

```bash
rm -rf scratch
```

Nothing from this task is committed except the two verdicts recorded in the plan.

---

## Task 1: Reel schema and paths

**Files:**
- Create: `lib/reel/schema.ts`
- Modify: `lib/paths.ts` (append reel helpers, after the handbook helpers)
- Test: `tests/reel.schema.test.ts`, `tests/reel.paths.test.ts`

**Interfaces:**
- Produces: `validateReel(data: unknown): Reel`, types `Reel`, `Beat`, `ReelAsset`, `Clip`, `CaptionCue`, `Overlay`, `Word`, `Timeline`, const `REEL_RATIOS: Record<string,[number,number]>`, `emptyReel(slug: string, over?: Partial<Reel>): Reel`
- Produces: `reelsRoot()`, `reelDir(slug)`, `reelFile(slug)`, `reelAssetsDir(slug)`, `reelRefsDir(slug)`, `reelVoFile(slug)`, `reelWordsFile(slug)`, `reelRendersDir(slug)`, `reelExportDir(slug)`, `patternsRoot()`, `patternDir(name)`

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/reel.schema.test.ts
import { describe, it, expect } from 'vitest';

describe('reel schema', () => {
  it('fills defaults for a minimal reel', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const r = validateReel({ pattern: 'armand', title: 'Grok Bot', beats: [
      { id: 'b1', role: 'hook', text: 'xAI just dropped Grok Bot.', shot: { kind: 'title', brief: 'stage b-roll' } },
    ] });
    expect(r.ratio).toBe('9:16');
    expect(r.fps).toBe(30);
    expect(r.brand).toBe('iolar');
    expect(r.beats[0].shot.hero).toBe(false);
    expect(r.timeline.clips).toEqual([]);
    expect(r.assets).toEqual([]);
  });

  it('rejects a beat with an unknown shot kind', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    expect(() => validateReel({ pattern: 'armand', title: 't', beats: [
      { id: 'b1', role: 'hook', text: 'x', shot: { kind: 'explosion', brief: '' } },
    ] })).toThrow();
  });

  it('rejects a clip whose end is not after its start', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    expect(() => validateReel({ pattern: 'armand', title: 't',
      beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'broll', brief: '' } }],
      timeline: { clips: [{ id: 'c1', assetId: 'a1', start: 4, end: 4, srcIn: 0 }] },
    })).toThrow();
  });

  it('exposes 9:16 as 1080x1920', async () => {
    const { REEL_RATIOS } = await import('@/lib/reel/schema');
    expect(REEL_RATIOS['9:16']).toEqual([1080, 1920]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/reel/schema'`.

- [ ] **Step 3: Write the schema**

```ts
// lib/reel/schema.ts
import { z } from 'zod';

export const REEL_RATIOS: Record<string, [number, number]> = {
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
};

export const SHOT_KINDS = ['title', 'talking-head', 'screen', 'broll'] as const;
export const MOTION_TYPES = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'hold'] as const;

const ShotSchema = z.object({
  kind: z.enum(SHOT_KINDS),
  brief: z.string().default(''),
  hero: z.boolean().default(false),
  assetId: z.string().optional(),
});

const BeatSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['hook', 'body', 'close']),
  text: z.string().min(1),
  shot: ShotSchema,
});

const WordSchema = z.object({ w: z.string(), start: z.number(), end: z.number() });

const AssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['video', 'image', 'audio']),
  path: z.string(),
  origin: z.enum(['user', 'comfy', 'higgsfield']),
  status: z.enum(['queued', 'running', 'ready', 'failed', 'awaiting-manual']).default('queued'),
  jobId: z.string().optional(),
  brief: z.string().default(''),
  error: z.string().optional(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const MotionSchema = z.object({
  type: z.enum(MOTION_TYPES).default('zoom-in'),
  strength: z.number().min(0).max(1).default(0.12),
  origin: z.tuple([z.number(), z.number()]).default([0.5, 0.5]),
});

const ClipSchema = z
  .object({
    id: z.string().min(1),
    assetId: z.string(),
    beatId: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    srcIn: z.number().min(0).default(0),
    fit: z.enum(['cover', 'contain']).default('cover'),
    motion: MotionSchema.default({}),
    transition: z.enum(['cut', 'crossfade']).default('cut'),
    locked: z.boolean().default(false),
  })
  .refine((c) => c.end > c.start, { message: 'clip end must be after start' });

const CaptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
  })
  .refine((c) => c.end > c.start, { message: 'caption end must be after start' });

const OverlaySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['hook-title']),
  start: z.number().min(0),
  end: z.number().min(0),
  props: z.record(z.string(), z.any()).default({}),
  locked: z.boolean().default(false),
});

const TimelineSchema = z.object({
  clips: z.array(ClipSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  overlays: z.array(OverlaySchema).default([]),
  music: z
    .object({ path: z.string().nullable().default(null), gainDb: z.number().default(-18), duckDb: z.number().default(-12) })
    .default({}),
});

export const ReelSchema = z.object({
  brand: z.string().default('iolar'),
  pattern: z.string().default('armand'),
  ratio: z.enum(['9:16', '4:5', '1:1']).default('9:16'),
  fps: z.number().int().min(24).max(60).default(30),
  seed: z.number().int().default(42),
  title: z.string(),
  beats: z.array(BeatSchema).min(1),
  vo: z
    .object({
      provider: z.enum(['higgsfield', 'manual']).default('higgsfield'),
      voiceId: z.string().default(''),
      file: z.string().default('vo.mp3'),
      durationSec: z.number().default(0),
      words: z.array(WordSchema).default([]),
    })
    .default({}),
  assets: z.array(AssetSchema).default([]),
  timeline: TimelineSchema.default({}),
  caption: z.object({ text: z.string(), hashtags: z.array(z.string()) }).default({ text: '', hashtags: [] }),
});

export type Reel = z.infer<typeof ReelSchema>;
export type Beat = Reel['beats'][number];
export type ReelAsset = Reel['assets'][number];
export type Timeline = Reel['timeline'];
export type Clip = Timeline['clips'][number];
export type CaptionCue = Timeline['captions'][number];
export type Overlay = Timeline['overlays'][number];
export type Word = Reel['vo']['words'][number];

export function validateReel(data: unknown): Reel {
  return ReelSchema.parse(data);
}

export function emptyReel(slug: string, over: Partial<Reel> = {}): Reel {
  return validateReel({
    title: slug.replace(/-/g, ' '),
    beats: [{ id: 'b1', role: 'hook', text: 'New reel.', shot: { kind: 'title', brief: '' } }],
    ...over,
  });
}
```

- [ ] **Step 4: Run the schema test**

Run: `npm test -- tests/reel.schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing paths test**

```ts
// tests/reel.paths.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-paths-')); });

describe('reel paths', () => {
  it('places every reel file under data/reel/<slug>', async () => {
    const { reelFile, reelAssetsDir, reelExportDir, reelVoFile } = await import('@/lib/paths');
    const root = process.env.IOLAR_DATA_DIR!;
    expect(reelFile('grok')).toBe(path.join(root, 'reel', 'grok', 'reel.json'));
    expect(reelAssetsDir('grok')).toBe(path.join(root, 'reel', 'grok', 'assets'));
    expect(reelExportDir('grok')).toBe(path.join(root, 'reel', 'grok', 'export'));
    expect(reelVoFile('grok')).toBe(path.join(root, 'reel', 'grok', 'vo.mp3'));
  });

  it('resolves patterns next to the repo templates, not under the data dir', async () => {
    const { patternDir } = await import('@/lib/paths');
    expect(patternDir('armand')).toBe(path.join(process.cwd(), 'patterns', 'armand'));
  });
});
```

- [ ] **Step 6: Run it and watch it fail, then append the helpers to `lib/paths.ts`**

```ts
// lib/paths.ts — appended below the handbook helpers
/** Reels live in a flat per-slug tree; patterns are repo assets, not user data. */
export function reelsRoot() { return path.join(dataRoot(), 'reel'); }
export function reelDir(slug: string) { return path.join(reelsRoot(), slug); }
export function reelFile(slug: string) { return path.join(reelDir(slug), 'reel.json'); }
export function reelAssetsDir(slug: string) { return path.join(reelDir(slug), 'assets'); }
export function reelRefsDir(slug: string) { return path.join(reelDir(slug), 'refs'); }
export function reelVoFile(slug: string) { return path.join(reelDir(slug), 'vo.mp3'); }
export function reelWordsFile(slug: string) { return path.join(reelDir(slug), 'vo.words.json'); }
export function reelRendersDir(slug: string) { return path.join(reelDir(slug), 'renders'); }
export function reelExportDir(slug: string) { return path.join(reelDir(slug), 'export'); }
export function patternsRoot() { return path.join(process.cwd(), 'patterns'); }
export function patternDir(name: string) { return path.join(patternsRoot(), name); }
```

- [ ] **Step 7: Run both tests, then commit**

Run: `npm test -- tests/reel.schema.test.ts tests/reel.paths.test.ts`
Expected: PASS (6 tests).

```bash
git add lib/reel/schema.ts lib/paths.ts tests/reel.schema.test.ts tests/reel.paths.test.ts
git commit -m "feat: reel.json schema and reel path helpers"
```

---

## Task 2: Reel store

**Files:**
- Create: `lib/reel/store.ts`
- Test: `tests/reel.store.test.ts`

**Interfaces:**
- Consumes: `validateReel`, `emptyReel`, `Reel`, `ReelAsset` (Task 1); `reelDir`, `reelFile`, `reelAssetsDir`, `reelsRoot` (Task 1)
- Produces: `createReel(slug, over?): Promise<Reel>`, `loadReel(slug): Promise<Reel>`, `saveReel(slug, reel): Promise<void>`, `listReels(): Promise<ReelMeta[]>`, `deleteReel(slug): Promise<void>`, `addAsset(slug, asset): Promise<ReelAsset>`, `updateAsset(slug, id, patch): Promise<ReelAsset>`, `reelStatus(reel): ReelStatus`; types `ReelMeta`, `ReelStatus`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-store-')); });

describe('reel store', () => {
  it('creates a reel and lists it', async () => {
    const { createReel, listReels } = await import('@/lib/reel/store');
    await createReel('grok-bot', { title: 'xAI drops Grok Bot' });
    const list = await listReels();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: 'grok-bot', title: 'xAI drops Grok Bot', status: 'draft', beats: 1 });
  });

  it('round-trips through save and validates on the way in', async () => {
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await createReel('grok-bot');
    await saveReel('grok-bot', { ...reel, seed: 7 });
    expect((await loadReel('grok-bot')).seed).toBe(7);
    await expect(saveReel('grok-bot', { ...reel, fps: 5 } as never)).rejects.toThrow();
  });

  it('appends assets with generated ids and patches their status', async () => {
    const { createReel, addAsset, updateAsset, loadReel } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    const a = await addAsset('grok-bot', { kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', brief: 'chat UI' });
    expect(a.id).toMatch(/^a\d+$/);
    await updateAsset('grok-bot', a.id, { status: 'ready', durationSec: 5 });
    const reel = await loadReel('grok-bot');
    expect(reel.assets[0]).toMatchObject({ status: 'ready', durationSec: 5 });
  });

  it('reports status from what exists', async () => {
    const { createReel, loadReel, saveReel, reelStatus } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    let reel = await loadReel('grok-bot');
    expect(reelStatus(reel)).toBe('draft');
    reel = { ...reel, vo: { ...reel.vo, words: [{ w: 'hi', start: 0, end: 0.2 }], durationSec: 1 } };
    expect(reelStatus(reel)).toBe('voiced');
    reel = { ...reel, timeline: { ...reel.timeline, clips: [
      { id: 'c1', assetId: 'a1', start: 0, end: 1, srcIn: 0, fit: 'cover',
        motion: { type: 'hold', strength: 0, origin: [0.5, 0.5] }, transition: 'cut', locked: false },
    ] } };
    await saveReel('grok-bot', reel);
    expect(reelStatus(await loadReel('grok-bot'))).toBe('assembled');
  });

  it('deletes a reel folder', async () => {
    const { createReel, deleteReel, listReels } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    await deleteReel('grok-bot');
    expect(await listReels()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.store.test.ts`
Expected: FAIL — `Cannot find module '@/lib/reel/store'`.

- [ ] **Step 3: Write the store**

```ts
// lib/reel/store.ts
import { promises as fs } from 'fs';
import path from 'path';
import { Reel, ReelAsset, emptyReel, validateReel } from './schema';
import { reelDir, reelFile, reelAssetsDir, reelsRoot, reelExportDir } from '../paths';

export type ReelStatus = 'draft' | 'voiced' | 'assembled' | 'exported';
export type ReelMeta = {
  slug: string; title: string; pattern: string; beats: number;
  durationSec: number; status: ReelStatus; updatedAt: string;
};

export function reelStatus(reel: Reel, exported = false): ReelStatus {
  if (exported) return 'exported';
  if (reel.timeline.clips.length) return 'assembled';
  if (reel.vo.words.length) return 'voiced';
  return 'draft';
}

export async function createReel(slug: string, over: Partial<Reel> = {}): Promise<Reel> {
  const reel = emptyReel(slug, over);
  await fs.mkdir(reelAssetsDir(slug), { recursive: true });
  await saveReel(slug, reel);
  return reel;
}

export async function loadReel(slug: string): Promise<Reel> {
  return validateReel(JSON.parse(await fs.readFile(reelFile(slug), 'utf8')));
}

export async function saveReel(slug: string, reel: Reel): Promise<void> {
  const valid = validateReel(reel);
  await fs.mkdir(reelDir(slug), { recursive: true });
  await fs.writeFile(reelFile(slug), JSON.stringify(valid, null, 2));
  try {
    const { syncReel } = await import('../graph');
    syncReel(slug, valid, reelStatus(valid));
  } catch (err) {
    console.warn('[instastudio] reel index failed for', slug, err);
  }
}

export async function deleteReel(slug: string): Promise<void> {
  await fs.rm(reelDir(slug), { recursive: true, force: true });
}

export async function listReels(): Promise<ReelMeta[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(reelsRoot(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
  const out: ReelMeta[] = [];
  for (const slug of names) {
    try {
      const reel = await loadReel(slug);
      const stat = await fs.stat(reelFile(slug));
      const exported = await fs.access(path.join(reelExportDir(slug), 'reel.mp4')).then(() => true).catch(() => false);
      const last = reel.timeline.clips.at(-1);
      out.push({
        slug, title: reel.title, pattern: reel.pattern, beats: reel.beats.length,
        durationSec: last ? last.end : reel.vo.durationSec,
        status: reelStatus(reel, exported), updatedAt: stat.mtime.toISOString(),
      });
    } catch { /* a half-written reel folder never breaks the list */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function addAsset(slug: string, asset: Omit<ReelAsset, 'id' | 'status'> & Partial<Pick<ReelAsset, 'status'>>): Promise<ReelAsset> {
  const reel = await loadReel(slug);
  const n = reel.assets.reduce((m, a) => Math.max(m, Number(a.id.slice(1)) || 0), 0) + 1;
  const full = validateReel({ ...reel, assets: [...reel.assets, { ...asset, id: `a${n}` }] }).assets.at(-1)!;
  await saveReel(slug, { ...reel, assets: [...reel.assets, full] });
  return full;
}

export async function updateAsset(slug: string, id: string, patch: Partial<ReelAsset>): Promise<ReelAsset> {
  const reel = await loadReel(slug);
  const assets = reel.assets.map((a) => (a.id === id ? { ...a, ...patch } : a));
  const found = assets.find((a) => a.id === id);
  if (!found) throw new Error(`asset ${id} not found in ${slug}`);
  await saveReel(slug, { ...reel, assets });
  return found;
}
```

`syncReel` does not exist yet — the dynamic import is inside a try/catch, exactly like `savePost`, so the store works before Task 17 adds it.

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/reel.store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reel/store.ts tests/reel.store.test.ts
git commit -m "feat: reel store with asset tracking and derived status"
```

---

## Task 3: Pattern presets and the first creator pattern

**Files:**
- Create: `lib/reel/patterns.ts`, `patterns/armand/pattern.json`, `patterns/armand/caption.css`, `patterns/armand/hook.html`
- Test: `tests/reel.patterns.test.ts`

**Interfaces:**
- Consumes: `patternsRoot`, `patternDir` (Task 1)
- Produces: `loadPattern(name): Promise<Pattern>`, `listPatterns(): Promise<PatternMeta[]>`, `patternCssVars(p: Pattern): string`, `validatePattern(data): Pattern`; type `Pattern`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.patterns.test.ts
import { describe, it, expect } from 'vitest';

describe('patterns', () => {
  it('loads the armand preset with its caption geometry', async () => {
    const { loadPattern } = await import('@/lib/reel/patterns');
    const p = await loadPattern('armand');
    expect(p.caption.yPct).toBe(73);
    expect(p.caption.wordsPerBeat).toEqual([1, 3]);
    expect(p.pacing.shotSec[0]).toBeLessThan(p.pacing.shotSec[1]);
    expect(p.transitions.length).toBeGreaterThan(0);
  });

  it('lists every pattern directory', async () => {
    const { listPatterns } = await import('@/lib/reel/patterns');
    const names = (await listPatterns()).map((p) => p.name);
    expect(names).toContain('armand');
  });

  it('emits css custom properties the stylesheet consumes', async () => {
    const { loadPattern, patternCssVars } = await import('@/lib/reel/patterns');
    const vars = patternCssVars(await loadPattern('armand'));
    expect(vars).toContain('--cap-y: 73%');
    expect(vars).toContain('--cap-size: 3.2vh');
    expect(vars).toContain('--cap-pill: rgba(0, 0, 0, 0.85)');
  });

  it('rejects a pattern missing its caption block', async () => {
    const { validatePattern } = await import('@/lib/reel/patterns');
    expect(() => validatePattern({ name: 'x', displayName: 'X' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.patterns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `patterns/armand/pattern.json`**

Values measured from the reference reel (720x1280, 24fps, 51.6s) analyzed in the spec.

```json
{
  "name": "armand",
  "displayName": "Armand Segall",
  "caption": {
    "font": "Inter, 'Segoe UI', system-ui, sans-serif",
    "weight": 800,
    "sizeVh": 3.2,
    "case": "none",
    "fg": "#ffffff",
    "pill": "#000000",
    "pillAlpha": 0.85,
    "radiusVh": 0.9,
    "padVh": [0.5, 1.1],
    "yPct": 73,
    "wordsPerBeat": [1, 3],
    "maxChars": 22
  },
  "pacing": { "shotSec": [3, 6], "captionBeatSec": [0.4, 1.1], "cutOnWordBoundary": true },
  "hook": { "layout": "title-over-broll", "durationSec": 1.6, "titleSizeVh": 6, "logoLockup": true },
  "shotMix": { "talkingHead": 0.35, "screen": 0.45, "broll": 0.2, "anchorEverySec": 10 },
  "motion": { "default": "zoom-in", "strength": 0.12 },
  "transitions": ["cut", "cut", "crossfade"],
  "voice": { "higgsfieldVoiceId": "", "rate": 1.0 },
  "letterbox": { "bg": "#ffffff" }
}
```

- [ ] **Step 4: Write `patterns/armand/caption.css`**

The single stylesheet used by both the DOM preview and the Playwright overlay pass. It styles one caption element; nothing else.

```css
/* patterns/armand/caption.css — consumed by the studio preview AND the export overlay pass. */
.reel-caption {
  position: absolute;
  left: 50%;
  top: var(--cap-y);
  transform: translate(-50%, -50%);
  max-width: 86%;
  text-align: center;
  font-family: var(--cap-font);
  font-weight: var(--cap-weight);
  font-size: var(--cap-size);
  line-height: 1.15;
  color: var(--cap-fg);
  text-transform: var(--cap-case);
  white-space: pre-wrap;
}
.reel-caption > span {
  background: var(--cap-pill);
  border-radius: var(--cap-radius);
  padding: var(--cap-pad-y) var(--cap-pad-x);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.reel-hook-title {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  width: 88%;
  text-align: center;
  font-family: var(--cap-font);
  font-weight: 900;
  font-size: var(--hook-size);
  line-height: 1.05;
  color: #fff;
  text-shadow: 0 0.4vh 2.4vh rgba(0, 0, 0, 0.55);
}
.reel-hook-title img { height: 1.15em; vertical-align: -0.18em; margin-inline-end: 0.25em; }
```

- [ ] **Step 5: Write `patterns/armand/hook.html`**

```html
<!-- Rendered into the overlay layer. {{title}} and {{logo}} are replaced by lib/reel/overlays.ts. -->
<div class="reel-hook-title">{{logo}}{{title}}</div>
```

- [ ] **Step 6: Write the loader**

```ts
// lib/reel/patterns.ts
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { patternDir, patternsRoot } from '../paths';

const PatternSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  caption: z.object({
    font: z.string(),
    weight: z.number().int(),
    sizeVh: z.number(),
    case: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
    fg: z.string(),
    pill: z.string(),
    pillAlpha: z.number().min(0).max(1),
    radiusVh: z.number(),
    padVh: z.tuple([z.number(), z.number()]),
    yPct: z.number().min(0).max(100),
    wordsPerBeat: z.tuple([z.number().int(), z.number().int()]),
    maxChars: z.number().int(),
  }),
  pacing: z.object({
    shotSec: z.tuple([z.number(), z.number()]),
    captionBeatSec: z.tuple([z.number(), z.number()]),
    cutOnWordBoundary: z.boolean().default(true),
  }),
  hook: z.object({
    layout: z.string(),
    durationSec: z.number(),
    titleSizeVh: z.number(),
    logoLockup: z.boolean().default(false),
  }),
  shotMix: z.object({
    talkingHead: z.number(), screen: z.number(), broll: z.number(), anchorEverySec: z.number(),
  }),
  motion: z.object({ default: z.string(), strength: z.number() }),
  transitions: z.array(z.enum(['cut', 'crossfade'])).min(1),
  voice: z.object({ higgsfieldVoiceId: z.string().default(''), rate: z.number().default(1) }).default({}),
  letterbox: z.object({ bg: z.string().default('#ffffff') }).default({}),
});

export type Pattern = z.infer<typeof PatternSchema>;
export type PatternMeta = { name: string; displayName: string; draft: boolean };

export function validatePattern(data: unknown): Pattern {
  return PatternSchema.parse(data);
}

export async function loadPattern(name: string): Promise<Pattern> {
  const file = path.join(patternDir(name), 'pattern.json');
  return validatePattern(JSON.parse(await fs.readFile(file, 'utf8')));
}

export async function listPatterns(): Promise<PatternMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(patternsRoot(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
  const out: PatternMeta[] = [];
  for (const name of dirs) {
    try {
      const p = await loadPattern(name);
      out.push({ name: p.name, displayName: p.displayName, draft: name.endsWith('-draft') });
    } catch { /* a malformed pattern dir is skipped, not fatal */ }
  }
  return out;
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The only place pattern.json becomes CSS. Preview and export both call this. */
export function patternCssVars(p: Pattern): string {
  const c = p.caption;
  return [
    `--cap-font: ${c.font}`,
    `--cap-weight: ${c.weight}`,
    `--cap-size: ${c.sizeVh}vh`,
    `--cap-case: ${c.case}`,
    `--cap-fg: ${c.fg}`,
    `--cap-pill: ${rgba(c.pill, c.pillAlpha)}`,
    `--cap-radius: ${c.radiusVh}vh`,
    `--cap-pad-y: ${c.padVh[0]}vh`,
    `--cap-pad-x: ${c.padVh[1]}vh`,
    `--cap-y: ${c.yPct}%`,
    `--hook-size: ${p.hook.titleSizeVh}vh`,
    `--letterbox-bg: ${p.letterbox.bg}`,
  ].join('; ');
}
```

- [ ] **Step 7: Run the test and commit**

Run: `npm test -- tests/reel.patterns.test.ts`
Expected: PASS (4 tests).

```bash
git add lib/reel/patterns.ts patterns/armand tests/reel.patterns.test.ts
git commit -m "feat: creator pattern presets and the armand preset"
```

---

## Task 4: Motion module — one spec, two renderers

**Files:**
- Create: `lib/reel/motion.ts`
- Test: `tests/reel.motion.test.ts`

**Interfaces:**
- Consumes: `Clip`, `MOTION_TYPES` (Task 1)
- Produces: `motionScaleAt(motion, progress): { scale: number; tx: number; ty: number }`, `motionCss(motion, progress): string`, `motionOriginCss(motion): string`, `motionFfmpeg(motion, opts: { fps: number; frames: number; width: number; height: number }): string`

Both renderers read `motionScaleAt`, so preview and export cannot diverge in how motion is computed — only in how it is expressed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.motion.test.ts
import { describe, it, expect } from 'vitest';

const zoomIn = { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] };

describe('motion', () => {
  it('zoom-in grows from 1 to 1+strength across the clip', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    expect(motionScaleAt(zoomIn, 0).scale).toBeCloseTo(1, 5);
    expect(motionScaleAt(zoomIn, 1).scale).toBeCloseTo(1.12, 5);
    expect(motionScaleAt(zoomIn, 0.5).scale).toBeCloseTo(1.06, 5);
  });

  it('zoom-out is zoom-in reversed and hold never moves', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const out = { ...zoomIn, type: 'zoom-out' as const };
    expect(motionScaleAt(out, 0).scale).toBeCloseTo(1.12, 5);
    expect(motionScaleAt(out, 1).scale).toBeCloseTo(1, 5);
    const hold = { ...zoomIn, type: 'hold' as const };
    expect(motionScaleAt(hold, 0.7)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it('pans translate without scaling past the safety margin', async () => {
    const { motionScaleAt } = await import('@/lib/reel/motion');
    const left = { ...zoomIn, type: 'pan-left' as const };
    expect(motionScaleAt(left, 0).tx).toBeCloseTo(0.12 / 2, 5);
    expect(motionScaleAt(left, 1).tx).toBeCloseTo(-0.12 / 2, 5);
    // a pan must stay zoomed in far enough that no edge shows
    expect(motionScaleAt(left, 0.5).scale).toBeCloseTo(1.12, 5);
  });

  it('emits a css transform the preview can apply verbatim', async () => {
    const { motionCss, motionOriginCss } = await import('@/lib/reel/motion');
    expect(motionCss(zoomIn, 0.5)).toBe('scale(1.06) translate(0%, 0%)');
    expect(motionOriginCss(zoomIn)).toBe('50% 40%');
  });

  it('emits a zoompan filter whose end zoom matches the css end scale', async () => {
    const { motionFfmpeg, motionScaleAt } = await import('@/lib/reel/motion');
    const f = motionFfmpeg(zoomIn, { fps: 30, frames: 150, width: 1080, height: 1920 });
    expect(f).toContain('zoompan=');
    expect(f).toContain('s=1080x1920');
    expect(f).toContain('fps=30');
    expect(f).toContain(String(motionScaleAt(zoomIn, 1).scale));
    expect(f).toContain('d=1');
  });

  it('hold still produces a valid filter so every clip has one', async () => {
    const { motionFfmpeg } = await import('@/lib/reel/motion');
    const f = motionFfmpeg({ type: 'hold', strength: 0, origin: [0.5, 0.5] }, { fps: 30, frames: 90, width: 1080, height: 1920 });
    expect(f).toContain('zoompan=');
    expect(f).toContain("z='1'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.motion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// lib/reel/motion.ts
import { Clip } from './schema';

export type Motion = Clip['motion'];
export type MotionFrame = { scale: number; tx: number; ty: number };

/** The single definition of what a motion does at a given progress (0..1).
 *  tx/ty are fractions of the frame, applied after scaling. */
export function motionScaleAt(m: Motion, progress: number): MotionFrame {
  const p = Math.min(1, Math.max(0, progress));
  const s = m.strength;
  switch (m.type) {
    case 'zoom-in':  return { scale: 1 + s * p, tx: 0, ty: 0 };
    case 'zoom-out': return { scale: 1 + s * (1 - p), tx: 0, ty: 0 };
    case 'pan-left':  return { scale: 1 + s, tx: s / 2 - s * p, ty: 0 };
    case 'pan-right': return { scale: 1 + s, tx: -s / 2 + s * p, ty: 0 };
    case 'hold':
    default: return { scale: 1, tx: 0, ty: 0 };
  }
}

function round(n: number) { return Math.round(n * 1e5) / 1e5; }

/** Preview side. */
export function motionCss(m: Motion, progress: number): string {
  const f = motionScaleAt(m, progress);
  return `scale(${round(f.scale)}) translate(${round(f.tx * 100)}%, ${round(f.ty * 100)}%)`;
}

export function motionOriginCss(m: Motion): string {
  return `${round(m.origin[0] * 100)}% ${round(m.origin[1] * 100)}%`;
}

/** Export side. zoompan with d=1 passes each input frame through with its own zoom,
 *  which is the reliable way to Ken Burns a video (plain scale cannot vary with time). */
export function motionFfmpeg(
  m: Motion,
  opts: { fps: number; frames: number; width: number; height: number }
): string {
  const { fps, frames, width, height } = opts;
  const n = Math.max(1, frames - 1);
  const start = motionScaleAt(m, 0);
  const end = motionScaleAt(m, 1);
  const z =
    m.type === 'hold' || m.strength === 0
      ? `'1'`
      : `'${round(start.scale)}+(${round(end.scale - start.scale)})*on/${n}'`;
  // x/y follow the origin, plus the pan offset expressed in output pixels.
  const panX = round((end.tx - start.tx) / n);
  const x = `'(iw-iw/zoom)*${round(m.origin[0])}+(${round(start.tx)}+${panX}*on)*iw'`;
  const y = `'(ih-ih/zoom)*${round(m.origin[1])}'`;
  return `zoompan=z=${z}:x=${x}:y=${y}:d=1:s=${width}x${height}:fps=${fps}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/reel.motion.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reel/motion.ts tests/reel.motion.test.ts
git commit -m "feat: motion module emitting matched css and ffmpeg zoompan"
```

---

## Task 5: Timeline resolver

**Files:**
- Create: `lib/reel/timeline.ts`
- Test: `tests/reel.timeline.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `Clip`, `CaptionCue`, `Overlay` (Task 1)
- Produces: `timelineDuration(t: Timeline): number`, `clipAt(t, time): Clip | null`, `clipProgress(clip, time): number`, `captionsAt(t, time): CaptionCue[]`, `overlaysAt(t, time): Overlay[]`, `frameAt(t, time): { clip, progress, captions, overlays }`, `sortTimeline(t): Timeline`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.timeline.test.ts
import { describe, it, expect } from 'vitest';

const clip = (id: string, start: number, end: number) => ({
  id, assetId: `a-${id}`, start, end, srcIn: 0, fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.5] as [number, number] },
  transition: 'cut' as const, locked: false,
});

const tl = {
  clips: [clip('c1', 0, 4), clip('c2', 4, 9)],
  captions: [
    { id: 'k1', text: 'just launched', start: 0.5, end: 1.4, hidden: false, locked: false },
    { id: 'k2', text: 'hidden one', start: 2, end: 3, hidden: true, locked: false },
  ],
  overlays: [{ id: 'o1', kind: 'hook-title' as const, start: 0.4, end: 1.6, props: {}, locked: false }],
  music: { path: null, gainDb: -18, duckDb: -12 },
};

describe('timeline resolver', () => {
  it('reports duration as the last clip end', async () => {
    const { timelineDuration } = await import('@/lib/reel/timeline');
    expect(timelineDuration(tl)).toBe(9);
  });

  it('finds the clip covering a time, half-open at the end', async () => {
    const { clipAt } = await import('@/lib/reel/timeline');
    expect(clipAt(tl, 0)?.id).toBe('c1');
    expect(clipAt(tl, 3.999)?.id).toBe('c1');
    expect(clipAt(tl, 4)?.id).toBe('c2');
    expect(clipAt(tl, 9)).toBeNull();
  });

  it('reports progress within the clip', async () => {
    const { clipAt, clipProgress } = await import('@/lib/reel/timeline');
    const c = clipAt(tl, 6.5)!;
    expect(clipProgress(c, 6.5)).toBeCloseTo(0.5, 5);
  });

  it('skips hidden captions', async () => {
    const { captionsAt } = await import('@/lib/reel/timeline');
    expect(captionsAt(tl, 1).map((c) => c.id)).toEqual(['k1']);
    expect(captionsAt(tl, 2.5)).toEqual([]);
  });

  it('returns a whole frame in one call', async () => {
    const { frameAt } = await import('@/lib/reel/timeline');
    const f = frameAt(tl, 1);
    expect(f.clip?.id).toBe('c1');
    expect(f.captions.map((c) => c.text)).toEqual(['just launched']);
    expect(f.overlays.map((o) => o.id)).toEqual(['o1']);
  });

  it('sorts everything by start time', async () => {
    const { sortTimeline } = await import('@/lib/reel/timeline');
    const messy = { ...tl, clips: [clip('c2', 4, 9), clip('c1', 0, 4)] };
    expect(sortTimeline(messy).clips.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.timeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver**

```ts
// lib/reel/timeline.ts
import { CaptionCue, Clip, Overlay, Timeline } from './schema';

export function timelineDuration(t: Timeline): number {
  return t.clips.reduce((m, c) => Math.max(m, c.end), 0);
}

/** Half-open [start, end): at an exact cut boundary the later clip wins, so no frame shows two. */
export function clipAt(t: Timeline, time: number): Clip | null {
  return t.clips.find((c) => time >= c.start && time < c.end) ?? null;
}

export function clipProgress(clip: Clip, time: number): number {
  const dur = clip.end - clip.start;
  if (dur <= 0) return 0;
  return Math.min(1, Math.max(0, (time - clip.start) / dur));
}

export function captionsAt(t: Timeline, time: number): CaptionCue[] {
  return t.captions.filter((c) => !c.hidden && time >= c.start && time < c.end);
}

export function overlaysAt(t: Timeline, time: number): Overlay[] {
  return t.overlays.filter((o) => time >= o.start && time < o.end);
}

export function frameAt(t: Timeline, time: number) {
  const clip = clipAt(t, time);
  return {
    clip,
    progress: clip ? clipProgress(clip, time) : 0,
    captions: captionsAt(t, time),
    overlays: overlaysAt(t, time),
  };
}

export function sortTimeline(t: Timeline): Timeline {
  const byStart = <T extends { start: number }>(xs: T[]) => [...xs].sort((a, b) => a.start - b.start);
  return { ...t, clips: byStart(t.clips), captions: byStart(t.captions), overlays: byStart(t.overlays) };
}
```

- [ ] **Step 4: Run the test and commit**

Run: `npm test -- tests/reel.timeline.test.ts`
Expected: PASS (6 tests).

```bash
git add lib/reel/timeline.ts tests/reel.timeline.test.ts
git commit -m "feat: timeline resolver shared by preview and export"
```

---

## Task 6: ASSEMBLE — words and pattern into a timeline

This is the heart of the autonomy: everything the studio shows is produced here without a human.

**Files:**
- Create: `lib/reel/assemble.ts`
- Test: `tests/reel.assemble.test.ts`

**Interfaces:**
- Consumes: `Reel`, `Beat`, `Word`, `Timeline`, `Clip`, `CaptionCue` (Task 1); `Pattern` (Task 3); `sortTimeline` (Task 5); `mulberry32` (`lib/rng.ts`)
- Produces: `assemble(input: AssembleInput): Timeline`, `groupCaptions(words, pattern): CaptionCue[]`, `beatSpans(beats, words): Map<string, { start: number; end: number }>`; type `AssembleInput = { reel: Reel; pattern: Pattern }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.assemble.test.ts
import { describe, it, expect } from 'vitest';

const PATTERN = {
  name: 'test', displayName: 'Test',
  caption: { font: 'Inter', weight: 800, sizeVh: 3.2, case: 'none' as const, fg: '#fff', pill: '#000',
             pillAlpha: 0.85, radiusVh: 0.9, padVh: [0.5, 1.1] as [number, number], yPct: 73,
             wordsPerBeat: [1, 3] as [number, number], maxChars: 22 },
  pacing: { shotSec: [3, 6] as [number, number], captionBeatSec: [0.4, 1.1] as [number, number], cutOnWordBoundary: true },
  hook: { layout: 'title-over-broll', durationSec: 1.6, titleSizeVh: 6, logoLockup: true },
  shotMix: { talkingHead: 0.35, screen: 0.45, broll: 0.2, anchorEverySec: 10 },
  motion: { default: 'zoom-in', strength: 0.12 },
  transitions: ['cut', 'cut', 'crossfade'] as ('cut' | 'crossfade')[],
  voice: { higgsfieldVoiceId: '', rate: 1 },
  letterbox: { bg: '#ffffff' },
};

// 12 words, 0.5s each: "one two three ... twelve"
const WORDS = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve']
  .map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.45 }));

async function baseReel() {
  const { validateReel } = await import('@/lib/reel/schema');
  return validateReel({
    pattern: 'test', title: 'Test', seed: 42,
    beats: [
      { id: 'b1', role: 'hook', text: 'one two three four', shot: { kind: 'broll', brief: 'stage', assetId: 'a1' } },
      { id: 'b2', role: 'body', text: 'five six seven eight', shot: { kind: 'screen', brief: 'chat ui', assetId: 'a2' } },
      { id: 'b3', role: 'close', text: 'nine ten eleven twelve', shot: { kind: 'talking-head', brief: 'creator', assetId: 'a3' } },
    ],
    vo: { words: WORDS, durationSec: 6 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready', durationSec: 5 },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'comfy', status: 'ready', durationSec: 5 },
      { id: 'a3', kind: 'video', path: 'assets/a3.mp4', origin: 'user', status: 'ready', durationSec: 5 },
    ],
  });
}

describe('assemble', () => {
  it('gives every beat a clip spanning its own words', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    expect(tl.clips).toHaveLength(3);
    expect(tl.clips[0]).toMatchObject({ beatId: 'b1', assetId: 'a1', start: 0 });
    expect(tl.clips[0].end).toBeCloseTo(2, 2);
    expect(tl.clips[1]).toMatchObject({ beatId: 'b2', assetId: 'a2' });
    expect(tl.clips[2].end).toBeCloseTo(5.95, 2);
  });

  it('leaves no gap and no overlap between clips', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    for (let i = 1; i < tl.clips.length; i++) expect(tl.clips[i].start).toBeCloseTo(tl.clips[i - 1].end, 5);
  });

  it('groups words into caption beats of 1-3 words under the char cap', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    const cues = groupCaptions(WORDS, PATTERN);
    expect(cues.length).toBeGreaterThanOrEqual(4);
    for (const c of cues) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(3);
      expect(c.text.length).toBeLessThanOrEqual(22);
      expect(c.end).toBeGreaterThan(c.start);
    }
    expect(cues[0].start).toBeCloseTo(0, 5);
    expect(cues.at(-1)!.end).toBeCloseTo(5.95, 2);
  });

  it('adds a hook overlay for the pattern hook duration', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    expect(tl.overlays).toHaveLength(1);
    expect(tl.overlays[0]).toMatchObject({ kind: 'hook-title', start: 0 });
    expect(tl.overlays[0].end).toBeCloseTo(1.6, 5);
    expect(tl.overlays[0].props.title).toBe('one two three four');
  });

  it('is deterministic for a seed and varies motion between neighbours', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const a = assemble({ reel, pattern: PATTERN });
    const b = assemble({ reel, pattern: PATTERN });
    expect(b).toEqual(a);
    const c = assemble({ reel: { ...reel, seed: 99 }, pattern: PATTERN });
    expect(c.clips.map((x) => x.motion)).not.toEqual(a.clips.map((x) => x.motion));
    expect(a.clips[0].motion.type).not.toBe(a.clips[1].motion.type);
  });

  it('preserves locked clips and captions verbatim, reflowing the rest around them', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const first = assemble({ reel, pattern: PATTERN });
    const editedClip = { ...first.clips[1], end: first.clips[1].end + 1, locked: true, motion: { type: 'hold' as const, strength: 0, origin: [0.5, 0.5] as [number, number] } };
    const withLock = { ...reel, timeline: { ...first, clips: first.clips.map((c) => (c.id === editedClip.id ? editedClip : c)) } };
    const second = assemble({ reel: withLock, pattern: PATTERN });
    const kept = second.clips.find((c) => c.id === editedClip.id)!;
    expect(kept).toEqual(editedClip);
    expect(second.clips.find((c) => c.beatId === 'b3')!.start).toBeCloseTo(editedClip.end, 5);
  });

  it('skips beats whose asset is not ready yet', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const pending = { ...reel, assets: reel.assets.map((a) => (a.id === 'a2' ? { ...a, status: 'queued' as const } : a)) };
    const tl = assemble({ reel: pending, pattern: PATTERN });
    expect(tl.clips.map((c) => c.beatId)).toEqual(['b1', 'b3']);
    // captions still cover the whole voiceover, so the reel stays watchable while shots generate
    expect(tl.captions.at(-1)!.end).toBeCloseTo(5.95, 2);
  });

  it('splits a beat longer than the pattern max shot length', async () => {
    const { assemble, groupCaptions } = await import('@/lib/reel/assemble');
    const long = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p']
      .map((w, i) => ({ w, start: i * 0.6, end: i * 0.6 + 0.55 }));
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test', title: 'Long', seed: 1,
      beats: [{ id: 'b1', role: 'body', text: long.map((w) => w.w).join(' '), shot: { kind: 'broll', brief: '', assetId: 'a1' } }],
      vo: { words: long, durationSec: 9.6 },
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready', durationSec: 10 }],
    });
    const tl = assemble({ reel, pattern: PATTERN });
    expect(tl.clips.length).toBe(2);
    for (const c of tl.clips) expect(c.end - c.start).toBeLessThanOrEqual(6.001);
    expect(groupCaptions(long, PATTERN).length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- tests/reel.assemble.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the module**

```ts
// lib/reel/assemble.ts
import { mulberry32 } from '../rng';
import { Pattern } from './patterns';
import { CaptionCue, Clip, Overlay, Reel, Timeline, Word } from './schema';
import { sortTimeline } from './timeline';

export type AssembleInput = { reel: Reel; pattern: Pattern };

/** Words belong to beats in script order: walk both lists together. */
export function beatSpans(reel: Reel): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>();
  let i = 0;
  for (const beat of reel.beats) {
    const count = beat.text.trim().split(/\s+/).filter(Boolean).length;
    const slice = reel.vo.words.slice(i, i + count);
    i += count;
    if (!slice.length) continue;
    spans.set(beat.id, { start: slice[0].start, end: slice.at(-1)!.end });
  }
  return spans;
}

export function groupCaptions(words: Word[], pattern: Pattern): CaptionCue[] {
  const [minW, maxW] = pattern.caption.wordsPerBeat;
  const [, maxSec] = pattern.pacing.captionBeatSec;
  const out: CaptionCue[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (!group.length) return;
    out.push({
      id: `k${out.length + 1}`,
      text: group.map((w) => w.w).join(' '),
      start: group[0].start,
      end: group.at(-1)!.end,
      hidden: false,
      locked: false,
    });
    group = [];
  };

  for (const w of words) {
    const next = [...group, w];
    const text = next.map((x) => x.w).join(' ');
    const span = w.end - next[0].start;
    const full = next.length >= maxW || text.length > pattern.caption.maxChars || span > maxSec;
    if (text.length > pattern.caption.maxChars && group.length >= minW) {
      flush();
      group = [w];
      continue;
    }
    group = next;
    if (full) flush();
  }
  flush();
  return out;
}

function pickMotion(rand: () => number, pattern: Pattern, prev?: Clip['motion']): Clip['motion'] {
  const kinds: Clip['motion']['type'][] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
  const choices = prev ? kinds.filter((k) => k !== prev.type) : kinds;
  const type = choices[Math.floor(rand() * choices.length)];
  const jitter = (rand() - 0.5) * 0.12;
  return {
    type,
    strength: Math.round((pattern.motion.strength * (0.8 + rand() * 0.4)) * 1e5) / 1e5,
    origin: [0.5, Math.round((0.45 + jitter) * 1e5) / 1e5],
  };
}

/** Rebuilds the timeline from beats + words, keeping every locked element byte-identical. */
export function assemble({ reel, pattern }: AssembleInput): Timeline {
  const rand = mulberry32(reel.seed);
  const spans = beatSpans(reel);
  const ready = new Set(reel.assets.filter((a) => a.status === 'ready').map((a) => a.id));
  const prev = reel.timeline;
  const lockedClips = prev.clips.filter((c) => c.locked);
  const lockedCaptions = prev.captions.filter((c) => c.locked);
  const lockedOverlays = prev.overlays.filter((o) => o.locked);
  const [, maxShot] = pattern.pacing.shotSec;

  const clips: Clip[] = [];
  let cursor = 0;
  let prevMotion: Clip['motion'] | undefined;

  for (const beat of reel.beats) {
    const span = spans.get(beat.id);
    const assetId = beat.shot.assetId;
    if (!span || !assetId || !ready.has(assetId)) continue;

    const lockedForBeat = lockedClips.filter((c) => c.beatId === beat.id);
    if (lockedForBeat.length) {
      for (const c of lockedForBeat) clips.push(c);
      cursor = Math.max(cursor, ...lockedForBeat.map((c) => c.end));
      continue;
    }

    const start = Math.max(cursor, span.start);
    const total = Math.max(0.2, span.end - start);
    const pieces = Math.max(1, Math.ceil(total / maxShot));
    const each = total / pieces;
    for (let p = 0; p < pieces; p++) {
      const motion = pickMotion(rand, pattern, prevMotion);
      prevMotion = motion;
      clips.push({
        id: `c${clips.length + 1}`,
        assetId,
        beatId: beat.id,
        start: Math.round((start + p * each) * 1e3) / 1e3,
        end: Math.round((start + (p + 1) * each) * 1e3) / 1e3,
        srcIn: Math.round(p * each * 1e3) / 1e3,
        fit: beat.shot.kind === 'screen' ? 'contain' : 'cover',
        motion,
        transition: pattern.transitions[clips.length % pattern.transitions.length],
        locked: false,
      });
    }
    cursor = clips.at(-1)!.end;
  }

  const generated = groupCaptions(reel.vo.words, pattern).filter(
    (c) => !lockedCaptions.some((l) => c.start < l.end && l.start < c.end)
  );
  const captions = [...lockedCaptions, ...generated];

  const hookBeat = reel.beats.find((b) => b.role === 'hook');
  const overlays: Overlay[] = lockedOverlays.length
    ? lockedOverlays
    : hookBeat
      ? [{
          id: 'o1', kind: 'hook-title', start: 0,
          end: Math.round(pattern.hook.durationSec * 1e3) / 1e3,
          props: { title: hookBeat.text }, locked: false,
        }]
      : [];

  return sortTimeline({ clips, captions, overlays, music: prev.music });
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -- tests/reel.assemble.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/reel/assemble.ts tests/reel.assemble.test.ts
git commit -m "feat: deterministic timeline assembly with lock preservation"
```

---

## Task 7: ffmpeg/ffprobe process helpers

**Files:**
- Create: `lib/reel/probe.ts`
- Test: `tests/reel.probe.test.ts`

**Interfaces:**
- Produces: `run(bin, args, opts?): Promise<{ code: number; stdout: string; stderr: string }>`, `ffprobeMedia(file): Promise<MediaInfo>`, `sceneCuts(file, threshold?): Promise<number[]>`, `extractFrames(file, times, outDir, width?): Promise<string[]>`, `ffmpegAvailable(): Promise<boolean>`, `makeTestClip(outPath, opts): Promise<void>`; type `MediaInfo = { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean }`

`makeTestClip` generates a synthetic clip with `testsrc2`/`sine` so later tasks can test the encoder without binary fixtures in git.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.probe.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-probe-'));
let available = false;

beforeAll(async () => {
  const { ffmpegAvailable } = await import('@/lib/reel/probe');
  available = await ffmpegAvailable();
});

describe('ffmpeg helpers', () => {
  it('reports availability without throwing', async () => {
    const { ffmpegAvailable } = await import('@/lib/reel/probe');
    expect(typeof (await ffmpegAvailable())).toBe('boolean');
  });

  it('probes a generated clip', async () => {
    if (!available) return;
    const { makeTestClip, ffprobeMedia } = await import('@/lib/reel/probe');
    const file = path.join(dir, 'clip.mp4');
    await makeTestClip(file, { seconds: 2, width: 320, height: 568, fps: 30, audio: true });
    const info = await ffprobeMedia(file);
    expect(info.width).toBe(320);
    expect(info.height).toBe(568);
    expect(info.fps).toBeCloseTo(30, 1);
    expect(info.durationSec).toBeCloseTo(2, 1);
    expect(info.hasAudio).toBe(true);
  }, 60_000);

  it('extracts frames at requested timestamps', async () => {
    if (!available) return;
    const { makeTestClip, extractFrames } = await import('@/lib/reel/probe');
    const { existsSync } = await import('fs');
    const file = path.join(dir, 'frames.mp4');
    await makeTestClip(file, { seconds: 3, width: 320, height: 568, fps: 30, audio: false });
    const out = await extractFrames(file, [0.5, 1.5], path.join(dir, 'frames'), 160);
    expect(out).toHaveLength(2);
    for (const f of out) expect(existsSync(f)).toBe(true);
  }, 60_000);

  it('finds scene cuts in a concatenation of two very different sources', async () => {
    if (!available) return;
    const { run, sceneCuts } = await import('@/lib/reel/probe');
    const file = path.join(dir, 'cuts.mp4');
    await run('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x568:d=2:r=30',
      '-f', 'lavfi', '-i', 'color=c=white:s=320x568:d=2:r=30',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    const cuts = await sceneCuts(file, 0.3);
    expect(cuts.some((t) => Math.abs(t - 2) < 0.3)).toBe(true);
  }, 90_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

```ts
// lib/reel/probe.ts
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export type MediaInfo = { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean };

/** ffmpeg/ffprobe/python are real executables: never spawn them through a shell. */
export function run(
  bin: string,
  args: string[],
  opts: { onStderr?: (chunk: string) => void; timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => { child.kill(); reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`)); }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; opts.onStderr?.(s); });
    child.on('error', reject);
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const { code } = await run('ffmpeg', ['-version'], { timeoutMs: 10_000 });
    return code === 0;
  } catch { return false; }
}

export async function ffprobeMedia(file: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate',
    file,
  ]);
  const data = JSON.parse(stdout || '{}');
  const streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const [num, den] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    durationSec: Number(data.format?.duration ?? 0),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: den ? num / den : 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Timestamps where the picture changes enough to be a cut. */
export async function sceneCuts(file: string, threshold = 0.3): Promise<number[]> {
  const { stderr } = await run('ffmpeg', [
    '-v', 'info', '-i', file,
    '-filter_complex', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-f', 'null', '-',
  ]);
  const times: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(m[1]));
  return times;
}

export async function extractFrames(file: string, times: number[], outDir: string, width?: number): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const out: string[] = [];
  for (const [i, t] of times.entries()) {
    const dest = path.join(outDir, `f${String(i + 1).padStart(3, '0')}.png`);
    const args = ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1'];
    if (width) args.push('-vf', `scale=${width}:-1`);
    args.push(dest);
    await run('ffmpeg', args);
    out.push(dest);
  }
  return out;
}

/** Synthetic clip so tests need no binary fixtures. */
export async function makeTestClip(
  outPath: string,
  opts: { seconds: number; width: number; height: number; fps: number; audio: boolean }
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const args = ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${opts.width}x${opts.height}:rate=${opts.fps}:duration=${opts.seconds}`];
  if (opts.audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.seconds}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(opts.seconds));
  if (opts.audio) args.push('-c:a', 'aac', '-shortest');
  args.push(outPath);
  const { code, stderr } = await run('ffmpeg', args);
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(0, 300)}`);
}
```

- [ ] **Step 4: Run the test and commit**

Run: `npm test -- tests/reel.probe.test.ts`
Expected: PASS (4 tests; three no-op if ffmpeg is missing).

```bash
git add lib/reel/probe.ts tests/reel.probe.test.ts
git commit -m "feat: ffmpeg and ffprobe process helpers"
```

---

## Task 8: Voice alignment with faster-whisper

**Files:**
- Create: `lib/reel/align.ts`, `scripts/setup-whisper.mjs`, `scripts/align.py`
- Modify: `lib/settings.ts` (add `whisperPython`, `whisperModel`, `whisperDevice`), `package.json` (add `setup:whisper` script)
- Test: `tests/reel.align.test.ts`

**Interfaces:**
- Consumes: `Word` (Task 1); `run` (Task 7)
- Produces: `whisperAvailable(): Promise<boolean>`, `alignVoice(audioPath, script): Promise<Word[]>`, `transcribe(audioPath): Promise<{ text: string; words: Word[] }>`, `WhisperUnavailableError`

- [ ] **Step 1: Write `scripts/align.py`**

A tiny script so the Node side never embeds Python in a string.

```python
# scripts/align.py — prints {"text": str, "words": [{"w","start","end"}]} on stdout.
import json, sys
from faster_whisper import WhisperModel

audio, model_name, device, compute = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
prompt = sys.stdin.read().strip() or None

model = WhisperModel(model_name, device=device, compute_type=compute)
segments, _ = model.transcribe(audio, word_timestamps=True, initial_prompt=prompt, vad_filter=False)

words, text = [], []
for seg in segments:
    text.append(seg.text.strip())
    for w in (seg.words or []):
        token = w.word.strip()
        if token:
            words.append({"w": token, "start": round(w.start, 3), "end": round(w.end, 3)})

json.dump({"text": " ".join(text).strip(), "words": words}, sys.stdout)
```

- [ ] **Step 2: Write `scripts/setup-whisper.mjs`**

```js
// scripts/setup-whisper.mjs — one-shot: creates .venv-whisper and installs faster-whisper.
import { spawnSync } from 'child_process';
import path from 'path';

const venv = path.join(process.cwd(), '.venv-whisper');
const python = process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python');

const step = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) { console.error(`failed: ${bin} ${args.join(' ')}`); process.exit(1); }
};

step('python', ['-m', 'venv', venv]);
step(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
step(python, ['-m', 'pip', 'install', 'faster-whisper']);
console.log(`\nwhisper ready. Set "whisperPython": ${JSON.stringify(python)} in data/settings.json (or leave it — it is the default).`);
```

Add to `package.json` scripts: `"setup:whisper": "node scripts/setup-whisper.mjs"`.

- [ ] **Step 3: Write the failing test**

```ts
// tests/reel.align.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-align-')); });

describe('alignment', () => {
  it('reports unavailability instead of throwing when python is missing', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ whisperPython: path.join(tmpdir(), 'definitely-not-python.exe') });
    const { whisperAvailable } = await import('@/lib/reel/align');
    expect(await whisperAvailable()).toBe(false);
  });

  it('throws a typed error when asked to align without whisper', async () => {
    const { saveSettings } = await import('@/lib/settings');
    saveSettings({ whisperPython: path.join(tmpdir(), 'definitely-not-python.exe') });
    const { alignVoice, WhisperUnavailableError } = await import('@/lib/reel/align');
    await expect(alignVoice(path.join(tmpdir(), 'x.mp3'), 'hello')).rejects.toBeInstanceOf(WhisperUnavailableError);
  });

  it('parses the python payload into words', async () => {
    const { parseAlignOutput } = await import('@/lib/reel/align');
    const words = parseAlignOutput('{"text":"hi there","words":[{"w":"hi","start":0,"end":0.2},{"w":"there","start":0.2,"end":0.5}]}');
    expect(words.words).toHaveLength(2);
    expect(words.words[1]).toEqual({ w: 'there', start: 0.2, end: 0.5 });
  });

  it('rejects a payload with no words rather than returning an empty timeline', async () => {
    const { parseAlignOutput } = await import('@/lib/reel/align');
    expect(() => parseAlignOutput('{"text":"","words":[]}')).toThrow(/no words/i);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm test -- tests/reel.align.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Add the settings fields**

In `lib/settings.ts`, extend `Settings` and `DEFAULTS`:

```ts
  whisperPython: string;
  whisperModel: string;
  whisperDevice: 'cuda' | 'cpu';
```

```ts
  whisperPython: path.join(process.cwd(), '.venv-whisper', 'Scripts', 'python.exe'),
  whisperModel: 'large-v3',
  whisperDevice: 'cuda',
```

(`lib/settings.ts` already imports `path`.) If Task 0 recorded that CUDA is unavailable, use `'small'` and `'cpu'` here instead.

- [ ] **Step 6: Write `lib/reel/align.ts`**

```ts
// lib/reel/align.ts
import path from 'path';
import { promises as fs } from 'fs';
import { getSettings } from '../settings';
import { Word } from './schema';
import { run } from './probe';

export class WhisperUnavailableError extends Error {
  constructor() {
    super('faster-whisper is not installed. Run `npm run setup:whisper`.');
    this.name = 'WhisperUnavailableError';
  }
}

function scriptPath() { return path.join(process.cwd(), 'scripts', 'align.py'); }

export async function whisperAvailable(): Promise<boolean> {
  const { whisperPython } = getSettings();
  try {
    await fs.access(whisperPython);
    const { code } = await run(whisperPython, ['-c', 'import faster_whisper'], { timeoutMs: 60_000 });
    return code === 0;
  } catch { return false; }
}

export function parseAlignOutput(stdout: string): { text: string; words: Word[] } {
  const data = JSON.parse(stdout.trim());
  const words: Word[] = (data.words ?? []).map((w: Word) => ({ w: String(w.w), start: Number(w.start), end: Number(w.end) }));
  if (!words.length) throw new Error('alignment returned no words');
  return { text: String(data.text ?? ''), words };
}

async function callWhisper(audioPath: string, prompt: string): Promise<{ text: string; words: Word[] }> {
  if (!(await whisperAvailable())) throw new WhisperUnavailableError();
  const s = getSettings();
  const compute = s.whisperDevice === 'cuda' ? 'float16' : 'int8';
  const { spawn } = await import('child_process');
  const child = spawn(s.whisperPython, [scriptPath(), audioPath, s.whisperModel, s.whisperDevice, compute], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdin.write(prompt);
  child.stdin.end();
  const code: number = await new Promise((res, rej) => { child.on('error', rej); child.on('close', (c) => res(c ?? -1)); });
  if (code !== 0) throw new Error(`whisper exited ${code}: ${stderr.slice(0, 400)}`);
  return parseAlignOutput(stdout);
}

/** The script is passed as the decoder prompt so product names align instead of being guessed. */
export function alignVoice(audioPath: string, script: string): Promise<Word[]> {
  return callWhisper(audioPath, script.slice(0, 800)).then((r) => r.words);
}

export function transcribe(audioPath: string): Promise<{ text: string; words: Word[] }> {
  return callWhisper(audioPath, '');
}
```

- [ ] **Step 7: Run the test and commit**

Run: `npm test -- tests/reel.align.test.ts`
Expected: PASS (4 tests).

```bash
git add lib/reel/align.ts lib/settings.ts scripts/align.py scripts/setup-whisper.mjs package.json tests/reel.align.test.ts
git commit -m "feat: faster-whisper word alignment with graceful absence"
```

---

## Task 9: Higgsfield adapter (voice and hero shots)

**Before starting:** read the Task 0 verdict. If the CLI bridge failed, implement only `requestManual` below and have `hfGenerateAudio`/`hfGenerateVideo` throw `HiggsfieldUnavailableError`; every caller already handles it.

**Files:**
- Create: `lib/higgsfield/client.ts`
- Test: `tests/higgsfield.test.ts`

**Interfaces:**
- Consumes: `runClaude`, `ClaudeUnavailableError` (`lib/ai/claude.ts`); `extractJson` (`lib/ai/revise.ts`)
- Produces: `hfAvailable(): Promise<boolean>`, `hfGenerateAudio(opts): Promise<{ url: string }>`, `hfGenerateVideo(opts): Promise<{ url: string }>`, `downloadTo(url, dest): Promise<void>`, `HiggsfieldUnavailableError`

- [ ] **Step 1: Write the failing test**

```ts
// tests/higgsfield.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { vi.resetModules(); });

describe('higgsfield adapter', () => {
  it('asks the CLI for audio and returns the media url', async () => {
    const runClaude = vi.fn().mockResolvedValue('Here you go: {"url":"https://cdn.example/vo.mp3"}');
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { hfGenerateAudio } = await import('@/lib/higgsfield/client');
    const out = await hfGenerateAudio({ text: 'hello world', voiceId: 'v1' });
    expect(out.url).toBe('https://cdn.example/vo.mp3');
    const prompt = runClaude.mock.calls[0][0] as string;
    expect(prompt).toContain('hello world');
    expect(prompt).toContain('v1');
    expect(runClaude.mock.calls[0][1].allowedTools).toContain('mcp__claude_ai_Higgsfield__generate_audio');
  });

  it('surfaces a typed error when the CLI is missing', async () => {
    class ClaudeUnavailableError extends Error {}
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockRejectedValue(new ClaudeUnavailableError()),
      ClaudeUnavailableError,
    }));
    const { hfGenerateVideo, HiggsfieldUnavailableError } = await import('@/lib/higgsfield/client');
    await expect(hfGenerateVideo({ prompt: 'stage b-roll', seconds: 5 })).rejects.toBeInstanceOf(HiggsfieldUnavailableError);
  });

  it('fails loudly when the reply carries no url', async () => {
    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue('I could not generate that.'),
      ClaudeUnavailableError: class extends Error {},
    }));
    const { hfGenerateAudio } = await import('@/lib/higgsfield/client');
    await expect(hfGenerateAudio({ text: 'x', voiceId: '' })).rejects.toThrow(/no media url/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/higgsfield.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```ts
// lib/higgsfield/client.ts
import { promises as fs } from 'fs';
import path from 'path';
import { ClaudeUnavailableError, runClaude } from '../ai/claude';
import { extractJson } from '../ai/revise';

export class HiggsfieldUnavailableError extends Error {
  constructor() {
    super('Higgsfield is unreachable. Generate the asset in Claude and drop the file into the reel instead.');
    this.name = 'HiggsfieldUnavailableError';
  }
}

const AUDIO_TOOL = 'mcp__claude_ai_Higgsfield__generate_audio';
const VIDEO_TOOL = 'mcp__claude_ai_Higgsfield__generate_video';
const JOB_TOOLS = ['mcp__claude_ai_Higgsfield__jobs_wait', 'mcp__claude_ai_Higgsfield__show_generation_by_ids'];

/** Higgsfield lives behind MCP, which only a Claude session has. The app borrows one
 *  through the same headless CLI it already uses for planning. */
async function ask(prompt: string, tools: string[]): Promise<{ url: string }> {
  let out: string;
  try {
    out = await runClaude(prompt, { timeoutMs: 900_000, allowedTools: tools });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) throw new HiggsfieldUnavailableError();
    throw err;
  }
  let url = '';
  try {
    const parsed = extractJson(out) as { url?: string };
    url = parsed?.url ?? '';
  } catch { /* fall through to the regex */ }
  if (!url) url = out.match(/https?:\/\/\S+\.(?:mp4|mp3|wav|m4a|webm)/i)?.[0] ?? '';
  if (!url) throw new Error(`higgsfield returned no media url: ${out.slice(0, 200)}`);
  return { url };
}

export async function hfAvailable(): Promise<boolean> {
  try {
    await runClaude('Reply with the single word OK.', { timeoutMs: 60_000 });
    return true;
  } catch { return false; }
}

export function hfGenerateAudio(opts: { text: string; voiceId: string }): Promise<{ url: string }> {
  return ask(
    `Use the Higgsfield generate_audio tool to speak this script${opts.voiceId ? ` with voice id ${opts.voiceId}` : ''}. ` +
      `Wait for the job to finish, then reply with ONLY {"url":"<direct media url>"} and no other text.\n\nSCRIPT:\n${opts.text}`,
    [AUDIO_TOOL, ...JOB_TOOLS]
  );
}

export function hfGenerateVideo(opts: { prompt: string; seconds: number }): Promise<{ url: string }> {
  return ask(
    `Use the Higgsfield generate_video tool to make a ${opts.seconds}-second vertical 9:16 clip: ${opts.prompt}. ` +
      `Wait for the job to finish, then reply with ONLY {"url":"<direct media url>"} and no other text.`,
    [VIDEO_TOOL, ...JOB_TOOLS]
  );
}

export async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} -> ${r.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}
```

- [ ] **Step 4: Run the test and commit**

Run: `npm test -- tests/higgsfield.test.ts`
Expected: PASS (3 tests).

```bash
git add lib/higgsfield/client.ts tests/higgsfield.test.ts
git commit -m "feat: higgsfield adapter over the headless claude cli"
```

---

## Task 10: ComfyUI image-to-video adapter

**Files:**
- Create: `lib/comfy/i2v.ts`, `lib/comfy/workflows/i2v.json`
- Modify: `lib/comfy/client.ts` (add `waitForVideo`, `fetchOutput`), `lib/settings.ts` (add `i2vModel`, `i2vFrames`)
- Test: `tests/comfy.i2v.test.ts`

**Interfaces:**
- Consumes: `queuePrompt`, `comfyUrl`, `getStats` (`lib/comfy/client.ts`)
- Produces: `buildI2vWorkflow(opts): object`, `animateImage(opts): Promise<{ promptId: string }>`, `collectVideo(promptId, dest): Promise<{ path: string }>`, `i2vAvailable(): Promise<boolean>`; type `I2vOpts = { imagePath: string; brief: string; seconds: number; seed: number; width: number; height: number }`

The workflow JSON is a template with `{{...}}` placeholders so a model swap is a data edit, not a code edit. Task 0's ComfyUI model check decides which nodes it contains; the version below targets a WAN-style image-to-video node set. **Before writing it**, run `mcp__comfy-mcp__search_templates` for "image to video", fetch the closest template, and use its actual node graph — the placeholders below must match the node ids in the template you fetch.

- [ ] **Step 1: Write the failing test**

```ts
// tests/comfy.i2v.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-i2v-'));
});

describe('comfy image-to-video', () => {
  it('fills the workflow template with the brief, seed and frame count', async () => {
    const { buildI2vWorkflow } = await import('@/lib/comfy/i2v');
    const wf = JSON.stringify(await buildI2vWorkflow({
      imageName: 'shot.png', brief: 'slow zoom over a chat UI', seconds: 5, seed: 7,
      width: 1080, height: 1920, fps: 30, model: 'wan.safetensors',
    }));
    expect(wf).toContain('slow zoom over a chat UI');
    expect(wf).toContain('shot.png');
    expect(wf).toContain('"seed": 7');
    expect(wf).not.toContain('{{');
  });

  it('queues the workflow and returns the prompt id', async () => {
    const queuePrompt = vi.fn().mockResolvedValue({ prompt_id: 'p-123' });
    const uploadImage = vi.fn().mockResolvedValue({ name: 'shot.png' });
    vi.doMock('@/lib/comfy/client', () => ({
      queuePrompt, uploadImage, comfyUrl: () => 'http://127.0.0.1:8188',
      getStats: vi.fn().mockResolvedValue({ up: true }), saveWorkflowToDesktop: vi.fn(),
    }));
    const dir = process.env.IOLAR_DATA_DIR!;
    const img = path.join(dir, 'shot.png');
    writeFileSync(img, 'x');
    const { animateImage } = await import('@/lib/comfy/i2v');
    const out = await animateImage({ imagePath: img, brief: 'chat ui', seconds: 4, seed: 1, width: 1080, height: 1920 });
    expect(out.promptId).toBe('p-123');
    expect(uploadImage).toHaveBeenCalled();
    expect(queuePrompt).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable rather than throwing when comfy is down', async () => {
    vi.doMock('@/lib/comfy/client', () => ({
      getStats: vi.fn().mockResolvedValue({ up: false }),
      queuePrompt: vi.fn(), uploadImage: vi.fn(), comfyUrl: () => '', saveWorkflowToDesktop: vi.fn(),
    }));
    const { i2vAvailable } = await import('@/lib/comfy/i2v');
    expect(await i2vAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/comfy.i2v.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the workflow template**

`lib/comfy/workflows/i2v.json` — API-format graph (the shape `/prompt` accepts), with placeholders `{{IMAGE}}`, `{{PROMPT}}`, `{{SEED}}`, `{{FRAMES}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{FPS}}`, `{{MODEL}}`. Take the node ids and class types from the ComfyUI template you fetched; do not invent node names.

- [ ] **Step 4: Write the adapter**

```ts
// lib/comfy/i2v.ts
import { promises as fs } from 'fs';
import path from 'path';
import { getSettings } from '../settings';
import { comfyUrl, getStats, queuePrompt, saveWorkflowToDesktop, uploadImage } from './client';

export type I2vOpts = {
  imagePath: string; brief: string; seconds: number; seed: number; width: number; height: number; fps?: number;
};

export async function i2vAvailable(): Promise<boolean> {
  return (await getStats()).up;
}

export async function buildI2vWorkflow(o: {
  imageName: string; brief: string; seconds: number; seed: number;
  width: number; height: number; fps: number; model: string;
}): Promise<object> {
  const tpl = await fs.readFile(path.join(process.cwd(), 'lib', 'comfy', 'workflows', 'i2v.json'), 'utf8');
  const filled = tpl
    .replace(/\{\{IMAGE\}\}/g, o.imageName)
    .replace(/\{\{PROMPT\}\}/g, o.brief.replace(/"/g, "'"))
    .replace(/\{\{SEED\}\}/g, String(o.seed))
    .replace(/\{\{FRAMES\}\}/g, String(Math.round(o.seconds * o.fps)))
    .replace(/\{\{WIDTH\}\}/g, String(o.width))
    .replace(/\{\{HEIGHT\}\}/g, String(o.height))
    .replace(/\{\{FPS\}\}/g, String(o.fps))
    .replace(/\{\{MODEL\}\}/g, o.model);
  return JSON.parse(filled);
}

export async function animateImage(o: I2vOpts): Promise<{ promptId: string }> {
  const s = getSettings();
  const name = `reel-${path.basename(o.imagePath)}`;
  await uploadImage(o.imagePath, name);
  const workflow = await buildI2vWorkflow({
    imageName: name, brief: o.brief, seconds: o.seconds, seed: o.seed,
    width: o.width, height: o.height, fps: o.fps ?? 30, model: s.i2vModel,
  });
  await saveWorkflowToDesktop(`reel-i2v-${o.seed}`, workflow);
  const { prompt_id } = await queuePrompt(workflow);
  return { promptId: prompt_id };
}

/** ComfyUI reports video outputs under `gifs`/`videos` depending on the save node. */
export async function collectVideo(promptId: string, dest: string): Promise<{ path: string }> {
  const r = await fetch(`${comfyUrl()}/history/${promptId}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`comfy history -> ${r.status}`);
  const entry = (await r.json())[promptId];
  if (!entry) throw new Error('comfy job not in history yet');
  if (entry.status?.status_str === 'error') {
    throw new Error(`comfy job failed: ${JSON.stringify(entry.status?.messages ?? []).slice(0, 300)}`);
  }
  type Out = { filename: string; subfolder: string; type: string };
  const files: Out[] = [];
  for (const node of Object.values(entry.outputs ?? {}) as Record<string, Out[]>[]) {
    for (const key of ['gifs', 'videos', 'images']) for (const f of node[key] ?? []) files.push(f);
  }
  const vid = files.find((f) => /\.(mp4|webm)$/i.test(f.filename)) ?? files[0];
  if (!vid) throw new Error('comfy job produced no video output');
  const q = new URLSearchParams({ filename: vid.filename, subfolder: vid.subfolder, type: vid.type });
  const dl = await fetch(`${comfyUrl()}/view?${q}`);
  if (!dl.ok) throw new Error(`comfy view -> ${dl.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await dl.arrayBuffer()));
  return { path: dest };
}
```

Add to `lib/settings.ts`: `i2vModel: string` (default `''`, meaning "whatever the workflow already names") and `i2vFrames: number` (default `120`).

- [ ] **Step 5: Run the test and commit**

Run: `npm test -- tests/comfy.i2v.test.ts`
Expected: PASS (3 tests).

```bash
git add lib/comfy/i2v.ts lib/comfy/workflows/i2v.json lib/settings.ts tests/comfy.i2v.test.ts
git commit -m "feat: comfyui image-to-video adapter for reel shots"
```

---

## Task 11: Reel CRUD routes and the list page

The first vertical slice a human can see: create a reel, see it listed, open it.

**Files:**
- Create: `app/api/reel/route.ts`, `app/api/reel/[slug]/route.ts`, `app/api/reel/patterns/route.ts`, `app/reel/page.tsx`
- Modify: `components/AppShell.tsx` (enable the Reels item, point it at `/reel`), `app/reels/page.tsx` (redirect to `/reel`)
- Test: `tests/api.reel.test.ts`

**Interfaces:**
- Consumes: `createReel`, `listReels`, `loadReel`, `saveReel`, `deleteReel` (Task 2); `listPatterns` (Task 3); `slugify`, `isSlug` (`lib/paths.ts`)
- Produces: `GET/POST /api/reel`, `GET/PUT/DELETE /api/reel/[slug]`, `GET /api/reel/patterns`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api.reel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => { process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-api-')); });

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('reel api', () => {
  it('creates a reel from a title and lists it', async () => {
    const { POST, GET } = await import('@/app/api/reel/route');
    const res = await POST(new Request('http://x/api/reel', {
      method: 'POST', body: JSON.stringify({ title: 'xAI drops Grok Bot' }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe('xai-drops-grok-bot');
    const list = await (await GET()).json();
    expect(list.reels).toHaveLength(1);
  });

  it('rejects a duplicate slug', async () => {
    const { POST } = await import('@/app/api/reel/route');
    const body = () => new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'Dup' }) });
    expect((await POST(body())).status).toBe(200);
    expect((await POST(body())).status).toBe(409);
  });

  it('gets, saves and deletes one reel', async () => {
    const { POST } = await import('@/app/api/reel/route');
    await POST(new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'Grok' }) }));
    const one = await import('@/app/api/reel/[slug]/route');
    const got = await (await one.GET(new Request('http://x'), ctx('grok'))).json();
    expect(got.reel.title).toBe('Grok');
    const put = await one.PUT(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: { ...got.reel, seed: 9 } }) }),
      ctx('grok')
    );
    expect(put.status).toBe(200);
    expect((await (await one.GET(new Request('http://x'), ctx('grok'))).json()).reel.seed).toBe(9);
    expect((await one.DELETE(new Request('http://x'), ctx('grok'))).status).toBe(200);
    expect((await one.GET(new Request('http://x'), ctx('grok'))).status).toBe(404);
  });

  it('rejects an invalid reel on save with 400, not 500', async () => {
    const { POST } = await import('@/app/api/reel/route');
    await POST(new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'Grok' }) }));
    const one = await import('@/app/api/reel/[slug]/route');
    const res = await one.PUT(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: { title: 'no beats', beats: [] } }) }),
      ctx('grok')
    );
    expect(res.status).toBe(400);
  });

  it('lists patterns', async () => {
    const { GET } = await import('@/app/api/reel/patterns/route');
    const out = await (await GET()).json();
    expect(out.patterns.map((p: { name: string }) => p.name)).toContain('armand');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/api.reel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `app/api/reel/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { createReel, listReels } from '@/lib/reel/store';
import { reelDir, slugify } from '@/lib/paths';

export async function GET() {
  return NextResponse.json({ reels: await listReels() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const title: string = body.title ?? '';
    const slug: string = body.slug ? slugify(body.slug) : slugify(title);
    if (!slug) return NextResponse.json({ error: 'title or slug required' }, { status: 400 });
    const exists = await fs.access(reelDir(slug)).then(() => true).catch(() => false);
    if (exists) return NextResponse.json({ error: `reel ${slug} already exists` }, { status: 409 });
    const reel = await createReel(slug, {
      title: title || slug,
      ...(body.pattern ? { pattern: body.pattern } : {}),
    });
    return NextResponse.json({ slug, reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write `app/api/reel/[slug]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { deleteReel, loadReel, saveReel } from '@/lib/reel/store';
import { validateReel } from '@/lib/reel/schema';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ reel: await loadReel(slug) });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  let reel;
  try {
    reel = validateReel(body.reel);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  try {
    await saveReel(slug, reel);
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  await deleteReel(slug);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Write `app/api/reel/patterns/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { listPatterns } from '@/lib/reel/patterns';

export async function GET() {
  return NextResponse.json({ patterns: await listPatterns() });
}
```

- [ ] **Step 6: Write the list page**

`app/reel/page.tsx` — a client component following `app/paperbook/page.tsx`: antd `Table` of `slug / title / pattern / beats / duration / status`, a "New reel" `Button` opening a `Modal` with a title `Input`, a pattern `Select` fed by `/api/reel/patterns`, and three radio modes (topic, paste, reference) whose payload goes to `POST /api/reel` then to the plan route in Task 12. Rows link to `/reel/<slug>`.

- [ ] **Step 7: Enable the nav item**

In `components/AppShell.tsx`, replace the reels entry:

```tsx
      { key: '/reel', icon: <VideoCameraOutlined />, label: 'Reels' },
```

and make `app/reels/page.tsx` redirect:

```tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/reel'); }
```

`tests/shell.test.tsx` asserts the Reels item is disabled — update that assertion to expect an enabled item.

- [ ] **Step 8: Run the suite and commit**

Run: `npm test -- tests/api.reel.test.ts tests/shell.test.tsx`
Expected: PASS.

```bash
git add app/api/reel app/reel app/reels/page.tsx components/AppShell.tsx tests/api.reel.test.ts tests/shell.test.tsx
git commit -m "feat: reel crud routes, list page and enabled reels nav"
```

---

## Task 12: PLAN — script generation in three modes

**Files:**
- Create: `lib/ai/reel/plan.ts`, `app/api/reel/[slug]/plan/route.ts`
- Test: `tests/reel.plan.test.ts`

**Interfaces:**
- Consumes: `runClaude` (`lib/ai/claude.ts`), `extractJson` (`lib/ai/revise.ts`), `loadPattern` (Task 3), `loadReel`/`saveReel` (Task 2), `transcribe` (Task 8), `reelRefsDir` (Task 1)
- Produces: `planFromTopic(slug, topic)`, `planFromScript(slug, script)`, `planFromReference(slug, mediaUrl)`, `beatsPrompt(pattern, mode, source)`, `parseBeats(raw): Beat[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.plan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-plan-'));
});

const BEATS = JSON.stringify({
  title: 'xAI drops Grok Bot',
  beats: [
    { id: 'b1', role: 'hook', text: 'xAI just dropped Grok Bot.', shot: { kind: 'title', brief: 'Elon on stage', hero: true } },
    { id: 'b2', role: 'body', text: 'It is an agent with its own computer.', shot: { kind: 'screen', brief: 'chat list UI' } },
    { id: 'b3', role: 'close', text: 'Beta today for Heavy subscribers.', shot: { kind: 'talking-head', brief: 'creator to camera' } },
  ],
  caption: { text: 'Grok Bot is here.', hashtags: ['#ai', '#xai'] },
});

describe('reel plan', () => {
  it('writes beats from a topic into the reel', async () => {
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockResolvedValue(BEATS), ClaudeUnavailableError: class extends Error {} }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('grok');
    const { planFromTopic } = await import('@/lib/ai/reel/plan');
    const reel = await planFromTopic('grok', 'xAI released Grok Bot today');
    expect(reel.beats).toHaveLength(3);
    expect(reel.beats[0].role).toBe('hook');
    expect(reel.beats[0].shot.hero).toBe(true);
    expect(reel.title).toBe('xAI drops Grok Bot');
    expect(reel.caption.hashtags).toContain('#ai');
  });

  it('keeps pasted wording verbatim across the beats', async () => {
    const script = 'One. Two. Three.';
    const runClaude = vi.fn().mockResolvedValue(JSON.stringify({
      title: 'T', caption: { text: '', hashtags: [] },
      beats: [
        { id: 'b1', role: 'hook', text: 'One.', shot: { kind: 'broll', brief: 'x' } },
        { id: 'b2', role: 'body', text: 'Two.', shot: { kind: 'screen', brief: 'y' } },
        { id: 'b3', role: 'close', text: 'Three.', shot: { kind: 'talking-head', brief: 'z' } },
      ],
    }));
    vi.doMock('@/lib/ai/claude', () => ({ runClaude, ClaudeUnavailableError: class extends Error {} }));
    const { createReel } = await import('@/lib/reel/store');
    await createReel('paste');
    const { planFromScript } = await import('@/lib/ai/reel/plan');
    const reel = await planFromScript('paste', script);
    expect(reel.beats.map((b) => b.text).join(' ')).toBe(script);
    expect(runClaude.mock.calls[0][0]).toContain('Do not rewrite');
  });

  it('gives every beat a shot brief and a unique id', async () => {
    const { parseBeats } = await import('@/lib/ai/reel/plan');
    const out = parseBeats(BEATS);
    expect(new Set(out.beats.map((b) => b.id)).size).toBe(3);
    for (const b of out.beats) expect(b.shot.brief.length).toBeGreaterThan(0);
  });

  it('tells Claude the pattern pacing so beats land near the shot length', async () => {
    const { beatsPrompt } = await import('@/lib/ai/reel/plan');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const prompt = beatsPrompt(await loadPattern('armand'), 'topic', 'anything');
    expect(prompt).toContain('3-6 seconds');
    expect(prompt).toContain('hook');
  });

  it('rejects a reply with no beats', async () => {
    const { parseBeats } = await import('@/lib/ai/reel/plan');
    expect(() => parseBeats('{"title":"x","beats":[]}')).toThrow(/beat/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/ai/reel/plan.ts`**

```ts
// lib/ai/reel/plan.ts
import { promises as fs } from 'fs';
import path from 'path';
import { runClaude } from '../claude';
import { extractJson } from '../revise';
import { loadPattern, Pattern } from '../../reel/patterns';
import { loadReel, saveReel } from '../../reel/store';
import { Beat, Reel } from '../../reel/schema';
import { reelRefsDir } from '../../paths';
import { transcribe } from '../../reel/align';

export type PlanOut = { title: string; beats: Beat[]; caption: { text: string; hashtags: string[] } };

const SHAPE = `Return ONLY JSON (no prose, no markdown fences):
{
  "title": string,
  "beats": [ { "id": "b1", "role": "hook"|"body"|"close", "text": string,
               "shot": { "kind": "title"|"talking-head"|"screen"|"broll", "brief": string, "hero": boolean } } ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Rules:
- exactly one "hook" beat first, exactly one "close" beat last, "body" in between
- "text" is spoken word-for-word by the voiceover: no stage directions, no emoji, no markdown
- "brief" describes the footage for that beat in one line, concrete enough to generate or screenshot
- "hero": true on at most two beats — the shots worth spending a premium generation on
- ids are b1, b2, b3 ... in order`;

export function beatsPrompt(pattern: Pattern, mode: 'topic' | 'paste' | 'reference', source: string): string {
  const [lo, hi] = pattern.pacing.shotSec;
  const voice = `Write in the voice of ${pattern.displayName}: direct, fast, no throat-clearing, second person, present tense.`;
  const pacing = `Each beat is one shot lasting ${lo}-${hi} seconds when spoken aloud — roughly ${Math.round(lo * 2.6)}-${Math.round(hi * 2.6)} words. ` +
    `Aim for a ${Math.round(pattern.hook.durationSec)}-second hook and 8-14 beats total.`;
  const mix = `Shot mix target: about ${Math.round(pattern.shotMix.screen * 100)}% screen recordings, ` +
    `${Math.round(pattern.shotMix.talkingHead * 100)}% talking head, ${Math.round(pattern.shotMix.broll * 100)}% b-roll. ` +
    `Return to a talking-head beat about every ${pattern.shotMix.anchorEverySec} seconds.`;

  const task =
    mode === 'paste'
      ? `Split this finished script into beats. Do not rewrite, reorder, shorten or improve a single word of it — the concatenated beat texts must equal the script exactly. Only add the shot briefs.\n\nSCRIPT:\n${source}`
      : mode === 'reference'
        ? `Here is the transcript of someone else's reel. Write a COMPLETELY FRESH original script on the same story with a similar arc. Never copy their phrasing.\n\nTRANSCRIPT:\n${source}`
        : `Write a short-form vertical video script about this.\n\nTOPIC:\n${source}`;

  return [task, voice, pacing, mix, SHAPE].join('\n\n');
}

export function parseBeats(raw: string): PlanOut {
  const data = extractJson(raw) as Partial<PlanOut>;
  const beats = (data.beats ?? []).map((b, i) => ({
    id: b.id || `b${i + 1}`,
    role: b.role,
    text: String(b.text ?? '').trim(),
    shot: {
      kind: b.shot?.kind ?? 'broll',
      brief: String(b.shot?.brief ?? '').trim() || 'establishing shot for this line',
      hero: Boolean(b.shot?.hero),
    },
  })) as Beat[];
  if (!beats.length) throw new Error('plan returned no beats');
  if (beats.some((b) => !b.text)) throw new Error('plan returned a beat with no spoken text');
  return {
    title: String(data.title ?? '').trim() || 'Untitled reel',
    beats,
    caption: { text: data.caption?.text ?? '', hashtags: data.caption?.hashtags ?? [] },
  };
}

async function applyPlan(slug: string, out: PlanOut): Promise<Reel> {
  const reel = await loadReel(slug);
  const next: Reel = { ...reel, title: out.title, beats: out.beats, caption: out.caption };
  await saveReel(slug, next);
  return next;
}

async function generate(slug: string, mode: 'topic' | 'paste' | 'reference', source: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const prompt = beatsPrompt(pattern, mode, source);
  const first = await runClaude(prompt, { timeoutMs: 900_000 });
  try {
    return await applyPlan(slug, parseBeats(first));
  } catch (err) {
    const retry = await runClaude(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 400)}. Return corrected JSON only.`,
      { timeoutMs: 900_000 }
    );
    return applyPlan(slug, parseBeats(retry));
  }
}

export function planFromTopic(slug: string, topic: string) { return generate(slug, 'topic', topic); }
export function planFromScript(slug: string, script: string) { return generate(slug, 'paste', script); }

/** Downloads the reference, transcribes it, then writes a fresh script on the same story. */
export async function planFromReference(slug: string, mediaUrl: string): Promise<Reel> {
  const dir = reelRefsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'reference.mp4');
  const r = await fetch(mediaUrl);
  if (!r.ok) throw new Error(`reference fetch ${mediaUrl} -> ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  const { text } = await transcribe(dest);
  await fs.writeFile(path.join(dir, 'transcript.txt'), text);
  return generate(slug, 'reference', text);
}
```

- [ ] **Step 4: Write the route**

```ts
// app/api/reel/[slug]/plan/route.ts
import { NextResponse } from 'next/server';
import { planFromReference, planFromScript, planFromTopic } from '@/lib/ai/reel/plan';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const reel =
      body.mode === 'paste' ? await planFromScript(slug, String(body.script ?? ''))
      : body.mode === 'reference' ? await planFromReference(slug, String(body.mediaUrl ?? ''))
      : await planFromTopic(slug, String(body.topic ?? ''));
    return NextResponse.json({ reel });
  } catch (err) {
    const status = String(err).includes('Claude CLI not found') ? 503 : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
```

- [ ] **Step 5: Run the test and commit**

Run: `npm test -- tests/reel.plan.test.ts`
Expected: PASS (5 tests).

```bash
git add lib/ai/reel/plan.ts app/api/reel/[slug]/plan/route.ts tests/reel.plan.test.ts
git commit -m "feat: reel script planning from topic, script or reference reel"
```

---

## Task 13: VOICE route

**Files:**
- Create: `app/api/reel/[slug]/voice/route.ts`, `lib/reel/voice.ts`
- Test: `tests/reel.voice.test.ts`

**Interfaces:**
- Consumes: `hfGenerateAudio`, `downloadTo`, `HiggsfieldUnavailableError` (Task 9); `alignVoice`, `WhisperUnavailableError` (Task 8); `loadPattern` (Task 3); `loadReel`, `saveReel` (Task 2); `ffprobeMedia` (Task 7)
- Produces: `synthesizeVoice(slug): Promise<Reel>`, `alignExistingVoice(slug): Promise<Reel>`, `voScript(reel): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reel.voice.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-voice-'));
});

async function seed(slug = 'grok') {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel(slug);
  const reel = await loadReel(slug);
  await saveReel(slug, { ...reel, beats: [
    { id: 'b1', role: 'hook', text: 'One two.', shot: { kind: 'title', brief: 'x', hero: false } },
    { id: 'b2', role: 'close', text: 'Three four.', shot: { kind: 'broll', brief: 'y', hero: false } },
  ] });
}

describe('voice stage', () => {
  it('joins beat text into one voiceover script', async () => {
    await seed();
    const { voScript } = await import('@/lib/reel/voice');
    const { loadReel } = await import('@/lib/reel/store');
    expect(voScript(await loadReel('grok'))).toBe('One two. Three four.');
  });

  it('downloads the TTS audio, aligns it and stores the words', async () => {
    await seed();
    const words = [
      { w: 'One', start: 0, end: 0.3 }, { w: 'two.', start: 0.3, end: 0.7 },
      { w: 'Three', start: 0.8, end: 1.1 }, { w: 'four.', start: 1.1, end: 1.5 },
    ];
    vi.doMock('@/lib/higgsfield/client', () => ({
      hfGenerateAudio: vi.fn().mockResolvedValue({ url: 'https://cdn/vo.mp3' }),
      downloadTo: vi.fn(async (_u: string, dest: string) => { writeFileSync(dest, 'audio'); }),
      HiggsfieldUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/reel/align', () => ({
      alignVoice: vi.fn().mockResolvedValue(words),
      WhisperUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/reel/probe', () => ({ ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 1.5, width: 0, height: 0, fps: 0, hasAudio: true }) }));
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    const reel = await synthesizeVoice('grok');
    expect(reel.vo.words).toHaveLength(4);
    expect(reel.vo.durationSec).toBeCloseTo(1.5, 3);
    const { existsSync } = await import('fs');
    const { reelWordsFile } = await import('@/lib/paths');
    expect(existsSync(reelWordsFile('grok'))).toBe(true);
  });

  it('keeps the audio and reports the failure when alignment is unavailable', async () => {
    await seed();
    class WhisperUnavailableError extends Error {}
    vi.doMock('@/lib/higgsfield/client', () => ({
      hfGenerateAudio: vi.fn().mockResolvedValue({ url: 'https://cdn/vo.mp3' }),
      downloadTo: vi.fn(async (_u: string, dest: string) => { writeFileSync(dest, 'audio'); }),
      HiggsfieldUnavailableError: class extends Error {},
    }));
    vi.doMock('@/lib/reel/align', () => ({
      alignVoice: vi.fn().mockRejectedValue(new WhisperUnavailableError()), WhisperUnavailableError,
    }));
    vi.doMock('@/lib/reel/probe', () => ({ ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 1.5, width: 0, height: 0, fps: 0, hasAudio: true }) }));
    const { synthesizeVoice } = await import('@/lib/reel/voice');
    await expect(synthesizeVoice('grok')).rejects.toBeInstanceOf(WhisperUnavailableError);
    const { existsSync } = await import('fs');
    const { reelVoFile } = await import('@/lib/paths');
    expect(existsSync(reelVoFile('grok'))).toBe(true);
  });

  it('returns 503 from the route when higgsfield is unreachable', async () => {
    await seed();
    class HiggsfieldUnavailableError extends Error {}
    vi.doMock('@/lib/reel/voice', () => ({
      synthesizeVoice: vi.fn().mockRejectedValue(new HiggsfieldUnavailableError()),
      alignExistingVoice: vi.fn(),
    }));
    vi.doMock('@/lib/higgsfield/client', () => ({ HiggsfieldUnavailableError }));
    const { POST } = await import('@/app/api/reel/[slug]/voice/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), { params: Promise.resolve({ slug: 'grok' }) });
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/reel.voice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/reel/voice.ts`**

```ts
// lib/reel/voice.ts
import { promises as fs } from 'fs';
import { Reel } from './schema';
import { loadReel, saveReel } from './store';
import { loadPattern } from './patterns';
import { reelVoFile, reelWordsFile } from '../paths';
import { alignVoice } from './align';
import { downloadTo, hfGenerateAudio } from '../higgsfield/client';
import { ffprobeMedia } from './probe';

export function voScript(reel: Reel): string {
  return reel.beats.map((b) => b.text.trim()).join(' ');
}

/** Alignment runs against whatever audio is on disk — TTS output or a creator's own recording. */
export async function alignExistingVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const audio = reelVoFile(slug);
  const info = await ffprobeMedia(audio);
  const words = await alignVoice(audio, voScript(reel));
  await fs.writeFile(reelWordsFile(slug), JSON.stringify(words, null, 2));
  const next: Reel = { ...reel, vo: { ...reel.vo, file: 'vo.mp3', durationSec: info.durationSec, words } };
  await saveReel(slug, next);
  return next;
}

export async function synthesizeVoice(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const { url } = await hfGenerateAudio({ text: voScript(reel), voiceId: pattern.voice.higgsfieldVoiceId });
  await downloadTo(url, reelVoFile(slug));
  // Audio is on disk before alignment runs, so a whisper failure never loses the voiceover.
  await saveReel(slug, { ...reel, vo: { ...reel.vo, provider: 'higgsfield', voiceId: pattern.voice.higgsfieldVoiceId } });
  return alignExistingVoice(slug);
}
```

- [ ] **Step 4: Write the route**

```ts
// app/api/reel/[slug]/voice/route.ts
import { NextResponse } from 'next/server';
import { alignExistingVoice, synthesizeVoice } from '@/lib/reel/voice';
import { HiggsfieldUnavailableError } from '@/lib/higgsfield/client';
import { WhisperUnavailableError } from '@/lib/reel/align';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const reel = body.alignOnly ? await alignExistingVoice(slug) : await synthesizeVoice(slug);
    return NextResponse.json({ reel });
  } catch (err) {
    if (err instanceof HiggsfieldUnavailableError || err instanceof WhisperUnavailableError) {
      return NextResponse.json({ error: String(err) }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the test and commit**

Run: `npm test -- tests/reel.voice.test.ts`
Expected: PASS (4 tests).

```bash
git add lib/reel/voice.ts app/api/reel/[slug]/voice/route.ts tests/reel.voice.test.ts
git commit -m "feat: voice stage — tts synthesis then word alignment"
```

---

## Task 14: SHOTS — asset generation and manual drops

**Files:**
- Create: `lib/reel/shots.ts`, `app/api/reel/[slug]/shots/route.ts`, `app/api/reel/[slug]/assets/route.ts`
- Test: `tests/reel.shots.test.ts`

**Interfaces:**
- Consumes: `animateImage`, `collectVideo`, `i2vAvailable` (Task 10); `hfGenerateVideo`, `downloadTo`, `HiggsfieldUnavailableError` (Task 9); `addAsset`, `updateAsset`, `loadReel`, `saveReel` (Task 2); `ffprobeMedia` (Task 7)
- Produces: `planShots(reel): ShotRequest[]`, `runShots(slug, opts?): Promise<Reel>`, `attachAsset(slug, beatId, file): Promise<Reel>`, `retryShot(slug, beatId, brief?)`; type `ShotRequest = { beatId: string; kind: Beat['shot']['kind']; brief: string; hero: boolean; seconds: number }`

Behaviour under test:

1. `planShots` skips beats that already point at a `ready` asset, and skips `title` beats (they are overlays, not clips).
2. A `hero` beat routes to Higgsfield; every other beat routes to ComfyUI; when ComfyUI is down the asset is written with `status: 'awaiting-manual'` rather than failing the run.
3. Each beat's shot length comes from its word span, clamped to the pattern's `shotSec`.
4. `attachAsset` writes the dropped file into `assets/`, probes it, appends a `ready` asset with `origin: 'user'`, and points the beat at it — overriding any generated asset for that beat.
5. A failed generation sets `status: 'failed'` plus `error`, and the rest of the run continues.
6. `runShots` is idempotent: running it twice does not queue the same beat twice.

Route: `POST /api/reel/[slug]/shots` runs the batch and returns the updated reel; `POST /api/reel/[slug]/assets` takes `multipart/form-data` (`file`, `beatId`) and calls `attachAsset`; `GET /api/reel/[slug]/assets?id=a3` streams the asset file back for the studio preview (`content-type` from its extension, `cache-control: no-store`).

- [ ] **Step 1:** Write `tests/reel.shots.test.ts` covering the six behaviours above, mocking `@/lib/comfy/i2v`, `@/lib/higgsfield/client` and `@/lib/reel/probe`.
- [ ] **Step 2:** Run it, watch it fail.
- [ ] **Step 3:** Write `lib/reel/shots.ts`.
- [ ] **Step 4:** Write both routes.
- [ ] **Step 5:** Run the test, then commit:

```bash
git add lib/reel/shots.ts app/api/reel/[slug]/shots app/api/reel/[slug]/assets tests/reel.shots.test.ts
git commit -m "feat: shot generation routing comfyui, higgsfield and manual drops"
```

---

## Task 15: ASSEMBLE route

**Files:**
- Create: `app/api/reel/[slug]/assemble/route.ts`
- Test: extend `tests/api.reel.test.ts`

**Interfaces:**
- Consumes: `assemble` (Task 6); `loadPattern` (Task 3); `loadReel`, `saveReel` (Task 2)
- Produces: `POST /api/reel/[slug]/assemble` → `{ reel }`

- [ ] **Step 1:** Write a test that seeds a reel with words + ready assets, POSTs to the route, and asserts the saved reel gained clips and captions; and a second test asserting a locked clip survives the call unchanged.
- [ ] **Step 2:** Run it, watch it fail.
- [ ] **Step 3:** Write the route (load reel, load its pattern, `assemble`, save, return).
- [ ] **Step 4:** Run the test, then commit:

```bash
git add app/api/reel/[slug]/assemble tests/api.reel.test.ts
git commit -m "feat: assemble route rebuilding the timeline from words and pattern"
```

---

## Task 16: Caption and overlay PNG rendering

**Files:**
- Create: `lib/reel/overlays.ts`
- Test: `tests/reel.overlays.test.ts`

**Interfaces:**
- Consumes: `patternCssVars`, `loadPattern` (Task 3); `Reel`, `CaptionCue`, `Overlay` (Task 1); the chromium singleton pattern from `lib/renderer/capture.ts`
- Produces: `overlayHtml(pattern, kind, content): string`, `renderOverlays(slug, reel, pattern, outDir): Promise<Map<string, string>>` (cue id → PNG path), `closeOverlayBrowser(): Promise<void>`

Key decisions:

- One Playwright page per reel, sized to the reel's pixel dimensions, `deviceScaleFactor: 1`, transparent background (`page.screenshot({ omitBackground: true })`).
- The page loads `patterns/<name>/caption.css` via a `file://` `<link>` and sets the custom properties from `patternCssVars` on `:root`, so the export uses byte-identical styling to the preview.
- Identical caption texts render once and share a PNG (`Map` keyed by `text|kind`), then every cue id points at that file.
- `hook.html` is read when present and `{{title}}` / `{{logo}}` are substituted; the logo becomes an `<img src="file://...">` when `props.logo` names a file inside the reel, otherwise it renders empty.

Test asserts: a PNG is produced per distinct caption, the file is a valid PNG with the reel's dimensions (read with `sharp`, already a dependency), repeated text reuses one file, and an empty timeline produces an empty map without launching a browser.

```bash
git add lib/reel/overlays.ts tests/reel.overlays.test.ts
git commit -m "feat: caption and hook overlays rendered from the pattern stylesheet"
```

---

## Task 17: EXPORT — the ffmpeg filter graph

**Files:**
- Create: `lib/reel/ffmpeg.ts`, `app/api/reel/[slug]/export/route.ts`
- Test: `tests/reel.ffmpeg.test.ts`

**Interfaces:**
- Consumes: `motionFfmpeg` (Task 4); `sortTimeline`, `timelineDuration` (Task 5); `renderOverlays` (Task 16); `run`, `ffprobeMedia`, `makeTestClip` (Task 7); `REEL_RATIOS` (Task 1)
- Produces: `buildExportArgs(input: ExportInput): string[]`, `exportReel(slug, onProgress?): Promise<{ path: string; durationSec: number }>`; type `ExportInput = { reel, pattern, assetPaths: Map<string,string>, overlayPaths: Map<string,string>, voPath: string | null, outPath: string }`

Graph shape, per clip `i`:

```
[i:v] trim=start=srcIn:duration=(end-start), setpts=PTS-STARTPTS,
      scale=W:H:force_original_aspect_ratio=(increase|decrease),
      crop=W:H  (cover)  |  pad=W:H:(ow-iw)/2:(oh-ih)/2:color=<letterbox.bg>  (contain),
      <motionFfmpeg>, fps=FPS, format=yuva420p  [v<i>]
```

then `concat=n=N:v=1:a=0` for cut transitions, with `xfade=transition=fade:duration=0.25:offset=<clip.start-0.25>` splicing in where a clip's `transition` is `crossfade`; then each overlay PNG as `[base][ovl<i>] overlay=x=0:y=0:enable='between(t,start,end)'`; then audio: `[vo]` plus optional music through `volume` and `sidechaincompress`, `-shortest`.

Tests (fast ones first, one slow real encode last):

1. `buildExportArgs` contains one `trim` per clip and one `overlay` per cue — pure string assertions, no ffmpeg.
2. `cover` produces `crop`, `contain` produces `pad` with the pattern's letterbox colour.
3. A `crossfade` clip yields an `xfade` with the right offset.
4. Real encode: three `makeTestClip` clips + one generated caption PNG + a `sine` audio track → the output ffprobes to the expected duration (±0.15s), fps, 1080x1920, and has an audio stream. Marked with a 180s timeout.
5. Progress: `exportReel` reports monotonically increasing fractions ending at 1.

Route `POST /api/reel/[slug]/export` returns an SSE stream (`text/event-stream`, `ReadableStream`) emitting `{"pct":0.42}` lines parsed from `ffmpeg -progress pipe:1`, then a final `{"done":true,"path":"export/reel.mp4"}`. It also writes `export/caption.txt` (caption text, blank line, hashtags joined by spaces).

```bash
git add lib/reel/ffmpeg.ts app/api/reel/[slug]/export tests/reel.ffmpeg.test.ts
git commit -m "feat: ffmpeg export with motion, overlays, transitions and progress"
```

---

## Task 18: Studio player

**Files:**
- Create: `components/reel/Player.tsx`
- Test: `tests/reel.player.test.tsx`

**Interfaces:**
- Consumes: `frameAt`, `timelineDuration` (Task 5); `motionCss`, `motionOriginCss` (Task 4); `patternCssVars` (Task 3)
- Produces: `<Player reel pattern assetSrc onTimeChange currentTime playing />`, `usePlayhead(audioRef, timeline)`

Behaviour:

- A `position: relative` stage with the reel's aspect ratio, `<video>`/`<img>` layers for the active clip (plus the next clip preloaded and hidden), a caption `<div class="reel-caption"><span>…</span></div>`, and the overlay layer.
- One `requestAnimationFrame` loop reads `audio.currentTime` when the VO exists, otherwise advances a monotonic clock, and calls `frameAt`.
- The clip element's `style.transform` comes from `motionCss`, `transformOrigin` from `motionOriginCss`. The video's `currentTime` is set to `clip.srcIn + (t - clip.start)` when it drifts more than 0.15s.
- Clips whose asset is not `ready` render a "generating…" placeholder card instead of a black frame.

jsdom test: render with a two-clip timeline at `currentTime = 1`, assert the caption text shown, the transform string on the active layer, and that switching `currentTime` to 5 swaps the active `assetId`. `HTMLMediaElement.play` is stubbed in the test (jsdom has no media stack).

```bash
git add components/reel/Player.tsx tests/reel.player.test.tsx
git commit -m "feat: dom reel player driven by the shared timeline resolver"
```

---

## Task 19: Studio page — timeline strip and edit ops

**Files:**
- Create: `app/reel/[slug]/page.tsx`, `components/reel/Timeline.tsx`, `components/reel/ClipPanel.tsx`, `components/reel/CaptionPanel.tsx`, `components/reel/ShotQueue.tsx`
- Test: `tests/reel.studio.test.tsx`

Layout as in the spec: player left, tabbed rail right (Beats / Shots / Caption), timeline strip beneath with a clip lane, a caption lane and a playhead.

Edit ops, each writing `locked: true` on what it touches and `PUT`ing the reel:

| op | where |
|---|---|
| trim in/out, split at playhead, delete, reorder | `Timeline.tsx` |
| replace asset, regenerate shot, motion preset + strength, fit | `ClipPanel.tsx` |
| caption text, merge/split, nudge ±0.05s, hide | `CaptionPanel.tsx` |
| pattern, seed, ratio, VO volume, music | studio toolbar |
| re-run PLAN / VOICE / SHOTS / ASSEMBLE / EXPORT | studio toolbar |

`ShotQueue.tsx` polls `GET /api/reel/[slug]` every 4s while any asset is `queued`/`running` so finished shots appear without a reload.

Undo is a bounded stack of previous `reel` objects held in page state (30 deep), applied with `Ctrl+Z`.

Test asserts: splitting at the playhead turns one clip into two whose ends meet and both carry `locked: true`; nudging a caption moves both its bounds; the toolbar's Export button disables while an export stream is open.

```bash
git add app/reel/[slug] components/reel tests/reel.studio.test.tsx
git commit -m "feat: reel studio with timeline editing and live shot queue"
```

---

## Task 20: Preview/export parity test

**Files:**
- Create: `tests/reel.parity.test.ts`, `tests/fixtures/parity-reel.json`

The test that keeps the two renderers honest:

1. Build a 3-second fixture reel: one `makeTestClip` asset, two captions, the armand pattern.
2. Export it with `exportReel`.
3. Extract export frames at t = 0.5, 1.5, 2.5 with `extractFrames`.
4. Render the same three timestamps in Playwright by mounting the player's markup — the same `caption.css`, the same `patternCssVars`, the same `motionCss` — over the same source frame pulled from the clip.
5. Compare with `sharp`: resize both to 270x480, compute mean absolute per-channel difference, assert under 12/255.

Skips itself (not fails) when ffmpeg is unavailable, like the other ffmpeg tests.

```bash
git add tests/reel.parity.test.ts tests/fixtures/parity-reel.json
git commit -m "test: pixel parity between the dom preview and the ffmpeg export"
```

---

## Task 21: Clone importer

**Files:**
- Create: `lib/reel/clone.ts`, `app/api/reel/patterns/clone/route.ts`
- Test: `tests/reel.clone.test.ts`

**Interfaces:**
- Consumes: `ffprobeMedia`, `sceneCuts`, `extractFrames`, `run` (Task 7); `transcribe` (Task 8); `validatePattern` (Task 3)
- Produces: `clonePattern(mediaUrl, name?): Promise<{ name: string; pattern: Pattern; report: CloneReport }>`, `measureCaptionBand(framePaths): Promise<{ yPct: number; pill: string; pillAlpha: number; sizeVh: number }>`; type `CloneReport = { measured: string[]; guessed: string[]; cuts: number[]; wordsPerBeat: [number, number] }`

Method:

1. Download to a temp dir, `ffprobeMedia` for ratio/fps/duration.
2. `sceneCuts` → gaps between cuts → `pacing.shotSec` as the 20th/80th percentile.
3. `transcribe` → word times → `captionBeatSec` percentiles; `wordsPerBeat` from the median words between pauses over 0.25s.
4. Sample 24 frames; for each, scan rows in the lower 45% for the row band whose pixels are strongly darker (or lighter) than their neighbours across a wide horizontal run — that is the pill. Median band centre → `yPct`; band height / frame height × 100 → `sizeVh` (÷ 1.6 for the pill padding); the modal pill colour → `pill` + `pillAlpha`.
5. First 3s → `hook.durationSec` (first cut after 0.8s) and `titleSizeVh` from the largest text band in that window.
6. Write `patterns/<name>-draft/pattern.json` plus a copy of `patterns/armand/caption.css` as the starting stylesheet, and a `report.json` splitting measured from guessed values.

Tests use a synthetic video built with ffmpeg (`color` sources concatenated with a `drawbox` band at a known height), asserting the detected `yPct` is within 4 points of the truth and the cut count matches. Skips when ffmpeg is unavailable.

Route `POST /api/reel/patterns/clone { mediaUrl, name? }` returns `{ name, report }`.

```bash
git add lib/reel/clone.ts app/api/reel/patterns/clone tests/reel.clone.test.ts
git commit -m "feat: clone a creator pattern from a reference reel"
```

---

## Task 22: Indexing, dashboard and settings

**Files:**
- Modify: `lib/db.ts` (add a `reels` table), `lib/graph.ts` (add `syncReel`, a `reel` node kind), `app/dashboard/page.tsx` (activate the Reels card with live counts), `app/settings/page.tsx` (expose the new settings fields), `README.md` (document the reel pipeline)
- Test: extend `tests/graph.test.ts`

`syncReel(slug, reel, status)` mirrors title, pattern, beat count, duration and status into SQLite and adds a `reel:<slug>` node linked to topic nodes extracted from the beat texts, reusing `topicKey`. The dashboard card reads `GET /api/reel` for its count and links to `/reel`.

Test: saving a reel makes it queryable through `graph()` with a `reel` node whose id is `reel:<slug>`.

```bash
git add lib/db.ts lib/graph.ts app/dashboard/page.tsx app/settings/page.tsx README.md tests/graph.test.ts
git commit -m "feat: index reels in sqlite and the knowledge graph"
```

---

## Self-review

**Spec coverage:** §3 storage → Task 1; §4 data model → Tasks 1-2; §5.1 PLAN → Task 12; §5.2 VOICE → Tasks 8, 13; §5.3 SHOTS → Tasks 9, 10, 14; §5.4 ASSEMBLE → Tasks 6, 15; §5.5 STUDIO → Tasks 18, 19; §5.6 EXPORT → Tasks 16, 17; §6 parity → Tasks 4, 5, 16, 20; §7 patterns and clone → Tasks 3, 21; §8 shared code and modified files → Tasks 11, 22; §9 dependencies → Tasks 0, 8, 10; §10 testing → every task plus Task 20.

**Naming consistency:** `assemble`, `groupCaptions`, `beatSpans` (Task 6) are consumed under those names in Task 15. `motionScaleAt`/`motionCss`/`motionFfmpeg` (Task 4) are consumed in Tasks 17-18, 20. `frameAt`/`clipAt`/`timelineDuration` (Task 5) in Tasks 17-18. `loadReel`/`saveReel`/`addAsset`/`updateAsset` (Task 2) throughout. `loadPattern`/`patternCssVars` (Task 3) in Tasks 6, 12, 16, 18.

**Known open items resolved during execution:** the exact ComfyUI i2v node graph (Task 10, Step 3 — fetch a real template first) and the Higgsfield CLI bridge verdict (Task 0).

