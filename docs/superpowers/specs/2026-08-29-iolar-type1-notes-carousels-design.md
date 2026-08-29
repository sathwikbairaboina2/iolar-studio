# iolar studio — Type 1: Instagram Notes-Carousel Generator

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Location:** `C:\Users\sathwik\projects\comfyui-projects\iolar-studio`

## 1. Purpose

Generate Instagram carousel posts (single or multi image) that look like premium handwritten tech notes — the style of the two analyzed reference posts (handwritten notebook pages: headings, tables, code snippets, diagrams, callout boxes, multi-color ink). Content must be **100% accurate and editable** — no diffusion-generated text. Brand: **iolar**.

This is category 1 of 5, named **paperbook**. Categories 2-5 (reels, stories, quote cards, memes) get placeholder pages now, own build cycles later.

Hard limit: **max 10 slides per post** (Instagram carousel cap the reference posts use). Enforced in schema validation, editor UI (add-slide disabled at 10), and AI pagination (Claude instructed to fit content within 10 slides; refuses/splits into a second post suggestion if content cannot fit).

## 2. Architecture

Four-stage pipeline; every stage independently re-runnable:

```
topic / raw notes
   └─> [1 PLAN]    Claude (in-session chat or in-app AI chat) writes post.json
   └─> [2 RENDER]  Deterministic: post.json + template -> PNG slides
                   (HTML templates + handwriting fonts + rough.js + Playwright)
   └─> [3 POLISH]  Optional ComfyUI passes (paper realism img2img, doodle assets)
   └─> [4 PACKAGE] Export folder: numbered PNGs + caption.txt + hashtags
```

Core principle (borrowed from PaperBanana): **generate code/markup, not pixels** — text accuracy guaranteed; ComfyUI adds organic feel only where it cannot break text.

## 3. App

Single **Next.js** app (App Router, TypeScript) + **Ant Design**. Local-only, no auth, no DB — filesystem is the store:

```
iolar-studio/
  app/                      # Next.js routes + API routes
  lib/
    renderer/               # block layout engine, template loader, Playwright capture
    comfy/                  # ComfyUI client (HTTP 127.0.0.1:8188)
    ai/                     # claude CLI headless invocation, diff builder, pagination
  templates/                # one dir per page template (HTML/CSS + manifest)
  assets/doodles/           # ComfyUI-generated reusable sketch assets
  data/
    paperbook/<slug>/post.json  # single source of truth per post
    paperbook/<slug>/renders/   # slide-NN.png + polished/
    paperbook/<slug>/export/    # final package
  docs/superpowers/specs/
```

### UI (Midnight Studio design, chosen from 3 presented directions)

Dark glass aesthetic, violet/blue gradient accents, glow highlights. **Light theme variant** included; toggle in topbar; implemented via antd theme tokens (two token sets, `ConfigProvider`), default **dark**.

Screens:
1. **Dashboard** — stat row, 5 category cards (Paperbook active; Reels/Stories/Quote cards/Memes "soon"), recent posts table, ComfyUI status pill (live: up/down, GPU, VRAM via `/system_stats`)
2. **Paperbook list** — table: slug, title, template, slides, status (draft/rendered/polished/packaged), actions
3. **Post editor** (core) —
   - toolbar: template picker (all 8), ratio picker, save state, Render slide / Render all / Polish / Package
   - slide chips 1..N + add (disabled at 10 — max slides cap)
   - left: block editor (antd forms; add/remove/reorder/duplicate blocks; per-type editors incl. mini table grid and code area)
   - right: sticky live preview of selected slide, re-render on save (~2s), full-size view, contact sheet (all slides grid)
   - **AI chat drawer** (see §6)
4. **Assets** — doodle library grid; "generate asset" form → ComfyUI job
5. **Settings** — brand handle, defaults (template, ratio), ComfyUI URL, theme

## 4. Content schema (`post.json`)

```json
{
  "brand": "iolar",
  "template": "spiral-notes",
  "ratio": "3:4",
  "seed": 42,
  "series": "PYTHON DATA STRUCTURES — DEEP DIVE",
  "date": "29/08/2026",
  "slides": [
    { "page_title": "...", "blocks": [
      { "type": "heading",  "text": "..." },
      { "type": "paragraph","text": "..." },
      { "type": "bullets",  "items": ["..."] },
      { "type": "sidebox",  "title": "...", "items": ["..."], "ink": "green" },
      { "type": "table",    "headers": ["..."], "rows": [["..."]] },
      { "type": "code",     "lang": "python", "lines": ["..."] },
      { "type": "diagram",  "kind": "flow|memory-cells|tree|compare", "spec": {} },
      { "type": "callout",  "style": "tip|takeaway|cloud", "title": "...", "text": "..." },
      { "type": "qa",       "q": "...", "a_bullets": ["..."], "example_code": ["..."] }
    ]}
  ],
  "caption": { "text": "...", "hashtags": ["..."] }
}
```

- Block types cover everything observed in the 20 reference slides.
- Templates interpret blocks (ink colors, fonts, framing); content stays pure.
- `seed` drives all jitter — same input = same output pixel-exact.

## 5. Rendering

- Playwright (headless Chromium) loads template HTML at 2× target (2160×2880 for 3:4), screenshots, downscales to 1080×1440.
- Ratios: **3:4 default** (1080×1440), 4:5 (1080×1350), 1:1 (1080×1080) selectable.
- Realism: 4-6 Google handwriting fonts rotated per ink role (Caveat, Kalam, Patrick Hand, Shadows Into Light, Architects Daughter, Gochi Hand); per-character rotation/baseline jitter (seeded); rough.js for boxes/tables/arrows/wavy underlines; slight page rotation; paper texture + vignette overlay.
- **Overflow guard**: layout engine measures block heights; if slide content exceeds page, render returns overflow error with measurements — never silently shrinks below legibility. UI surfaces warning + "Auto-fix with AI" (see §6).

### Templates (8, all selectable; default `spiral-notes`)

| name | description | origin |
|---|---|---|
| `spiral-notes` | spiral notebook, ruled paper, blue/red/green ink, date header | clone of reference post 1 |
| `margin-qa` | white page, red margin, Q&A red/blue, cloud callout, logo doodle | clone of reference post 2 |
| `blackboard` | dark green chalkboard, wood frame, pastel chalk | new |
| `studygram-pastel` | cream paper, highlighter swipes, washi tape, soft cards | new |
| `engineer-grid` | graph paper, blueprint ink, spec-sheet stamps, flow nodes | new |
| `terminal-dark` | editor-window chrome, neon glow handwriting + monospace code | new |
| `legal-pad` | yellow pad, ballpoint, red margin scribbles, coffee stain | new |
| `sticky-wall` | post-its on cork board with pins and strings | new |

Template = directory: `template.html` + `manifest.json` (declared ink roles, fonts, block support) + preview thumbnail. Adding a template touches nothing else.

## 6. AI integration (Claude)

Backend invokes **`claude` CLI headless (`claude -p`)** using the user's existing Claude Code auth — no API key management. Three entry points:

1. **Planning**: user asks in Claude Code chat OR in-app "New post with AI": topic-only (mode A) or raw notes (mode B) → Claude writes complete `post.json`.
2. **Revise chat** (editor drawer): scope selector (this slide / whole post / caption). User request → Claude receives post.json + request → returns modified JSON → UI shows per-block diff cards (old/new) → Apply & re-render / Discard / Apply all. Chat history persisted per post.
3. **Auto-pagination / reflow**:
   - chat commands like "fit this into 7 slides", "split slide 3 in two", "merge slides 5-6"
   - paste arbitrary-length raw content → Claude splits into balanced slides respecting per-slide capacity budgets (chars per block type, measured from templates)
   - overflow warning button "Auto-fix with AI" → Claude moves spilling blocks to next slide or condenses text, returns diff for approval

All AI edits go through the same diff-approve flow — AI never silently mutates post.json.

## 7. ComfyUI integration

Via local ComfyUI **Desktop** instance (127.0.0.1:8188) so all jobs appear in the Desktop app's queue/history; outputs land in its shared output dir. Workflow JSONs additionally saved to Desktop's `user\default\workflows` so the user can open them in the ComfyUI UI.

1. **Doodle asset generation** (one-time + on-demand): Qwen-Image generates sketch-style assets (tech logos, lightbulbs, stars, trophies, mascots) → stored `assets/doodles/`, referenced by templates. Model availability checked first; if Qwen-Image absent, ask user before large download.
2. **Paper realism pass** (optional per post): img2img denoise 0.10-0.15 over rendered slides — organic ink/paper feel, text preserved. A/B compare gate before adopting; skip if legibility degrades.

App shows ComfyUI liveness/VRAM in UI; degrades gracefully when ComfyUI down (render pipeline works without it).

## 8. Testing

- **Golden renders**: sample post.json per template, pixel-diff vs approved goldens (regression gate).
- **Overflow guard tests**: oversized content must error, not shrink.
- **Schema validation**: post.json validated (zod) at every load/AI-edit boundary.
- **API route smoke tests**: render, revise-diff apply, package.
- **Contact sheet** for human review pre-package.

## 9. Out of scope (v1)

- Publishing to Instagram (export folder only)
- Reels/Stories/Quote cards/Memes implementations
- Multi-user/auth/cloud
- Custom handwriting font training (handwright route noted for later)
- In-app planning UI beyond chat (no wizard)

## 10. Key decisions log

| decision | choice |
|---|---|
| Accuracy strategy | HTML render ("code not pixels"), diffusion never renders text |
| Planner LLM | Claude via session / claude CLI headless |
| Brand | iolar |
| Templates | all 8, default spiral-notes |
| Ratio | 3:4 default; 4:5, 1:1 optional |
| UI direction | Midnight Studio (dark) + light variant, antd tokens |
| ComfyUI visibility | all jobs through Desktop instance on 8188 |
| Categories | paperbook now; reels, stories, quote cards, memes scaffolded |
| Max slides | 10 per post (schema + UI + AI pagination enforced) |
