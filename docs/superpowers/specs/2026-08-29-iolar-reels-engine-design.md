# iolar studio — Type 2: Reels Engine

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Location:** `C:\Users\sathwik\projects\comfyui-projects\iolar-studio`
**Branch:** `feat/short-video`

## 1. Purpose

Generate vertical short-form video (Instagram Reels / Shorts / TikTok) end to end: script, voiceover,
shot assets, edit, export. Category name **reel** — category 2 of 5, sibling of `paperbook`.

Reference: an AI-news explainer reel analyzed frame by frame (720x1280, 24fps, 51.6s, H.264 + AAC).
Its shape defines the target output:

- 0-1.6s hook: b-roll under a large bold title + product logo lockup
- talking head anchor returning every ~10s, full-bleed
- b-roll blocks of 3-6s: product screen recordings and site screenshots with slow Ken Burns zoom/pan;
  some full-bleed, some letterboxed on flat white; article scroll-captures with phrases highlighted
- burned-in karaoke captions the whole way: 1-3 words per beat, bold white sans, black rounded pill,
  fixed lower third (~73% height), centered — changing every ~0.5-1s
- pacing carried by the voiceover, not music

The engine reproduces this class of reel for **several creators**, each with their own script voice and
edit pattern. Assets come mostly from ComfyUI (screenshots animated into clips), Higgsfield for hero
shots, and the user's own drops.

Guiding principle inherited from paperbook: **generate markup, not pixels, wherever text appears.**
Captions and titles are HTML/CSS in both preview and export — diffusion never renders text.

Second principle, new here: **the studio is autonomous first, editable second.** A reel should be
watchable the moment its assets land; manual editing is a minimal InShot-style pass over an
already-finished timeline, not an authoring tool.

## 2. Architecture

Six stages, each independently re-runnable, each its own API route + lib module:

```
topic / pasted script / reference reel
  |-> [1 PLAN]     Claude writes beats (hook/body/close) + shot briefs in creator voice
  |-> [2 VOICE]    Higgsfield TTS (cloned creator voice) -> vo.mp3
                   faster-whisper -> word-level timestamps (vo.words.json)
  |-> [3 SHOTS]    per beat: ComfyUI i2v (default) / Higgsfield (hero) / user drop (override)
                   async jobs, tracked in reel.json assets[]
  |-> [4 ASSEMBLE] word timings + pattern pacing -> clips, caption beats, overlays (deterministic, seeded)
  |-> [5 STUDIO]   DOM preview + minimal edits, writes back to timeline
  |-> [6 EXPORT]   ffmpeg -> export/reel.mp4 + caption.txt
```

Stages 3 and 5 overlap by design: the studio is usable while shots are still generating; finished
assets appear in the timeline live.

## 3. Storage

```
data/reel/<slug>/
  reel.json            # single source of truth
  assets/              # dropped + generated media (mp4, png)
  refs/                # reference reel + sampled frames, when reference mode used
  vo.mp3
  vo.words.json
  renders/             # caption/overlay PNGs, ffmpeg scratch
  export/reel.mp4  export/caption.txt
patterns/<name>/
  pattern.json  caption.css  hook.html (optional)
```

Same filesystem-is-the-store model as paperbook: `reel.json` is authoritative, SQLite and the knowledge
graph are mirrors written by the existing indexer.

## 4. Data model

`reel.json`, validated by zod (new `lib/reel/schema.ts`; paperbook's `PostSchema` untouched):

```jsonc
{
  "brand": "iolar",
  "pattern": "armand",
  "ratio": "9:16",              // 1080x1920; "4:5" and "1:1" allowed
  "fps": 30,
  "seed": 42,
  "title": "xAI drops Grok Bot",

  "beats": [
    { "id": "b1",
      "role": "hook",           // hook | body | close
      "text": "xAI just dropped Grok Bot.",
      "shot": { "kind": "title",        // title | talking-head | screen | broll
                "brief": "Elon on stage, slow push in",
                "hero": false,          // true -> generate with Higgsfield instead of ComfyUI
                "assetId": "a1" } }
  ],

  "vo": { "provider": "higgsfield",
          "voiceId": "...",
          "file": "vo.mp3",
          "durationSec": 51.6,
          "words": [ { "w": "xAI", "start": 0.12, "end": 0.31 } ] },

  "assets": [
    { "id": "a1", "kind": "video",      // video | image | audio
      "path": "assets/a1.mp4",
      "origin": "comfy",                // user | comfy | higgsfield
      "jobId": "...", "status": "ready", // queued | running | ready | failed
      "brief": "chat list UI, slow zoom",
      "durationSec": 5.0, "width": 1080, "height": 1920 }
  ],

  "timeline": {
    "clips": [
      { "id": "c1", "assetId": "a1", "start": 4.10, "end": 9.60, "srcIn": 0.0,
        "fit": "cover",                  // cover | contain (contain letterboxes on pattern bg)
        "motion": { "type": "zoom-in", "strength": 0.12, "origin": [0.5, 0.4] },
        "transition": "cut",             // cut | crossfade
        "locked": false }
    ],
    "captions": [ { "id": "k1", "text": "just launched", "start": 4.10, "end": 4.92,
                    "hidden": false, "locked": false } ],
    "overlays": [ { "id": "o1", "kind": "hook-title", "start": 0.40, "end": 1.60,
                    "props": { "title": "xAI just dropped", "logo": "assets/logo.png" } } ],
    "music": { "path": null, "gainDb": -18, "duckDb": -12 }
  },

  "caption": { "text": "...", "hashtags": ["..."] }
}
```

**Lock semantics.** ASSEMBLE regenerates `clips`, `captions` and `overlays` from beats and word timings.
Any element a human touched in the studio carries `locked: true` and is preserved verbatim across
re-assembly; unlocked siblings reflow around it. This is what makes stages re-runnable without
destroying manual work.

## 5. Stages in detail

### 5.1 PLAN — `POST /api/reel/[slug]/plan`

Three input modes, one modal (mirrors paperbook's three-way New Post modal):

| mode | input | behavior |
|---|---|---|
| topic | topic string or source URL | script written from the given text or link content |
| paste | finished script | Claude only segments into beats and writes shot briefs; wording preserved |
| reference | reel URL on the local media server | download to `refs/`, transcribe with faster-whisper, sample frames, then write a **fresh original** script on the same story and arc — never a copy |

Output: `beats[]` in the pattern's creator voice, each with `role` and a `shot` brief. Claude is given
the pattern's `shotMix` and `pacing` so beat lengths land near the target shot durations.

Invoked through the existing `lib/ai/claude.ts` headless CLI path. Same diff-approve rule as
paperbook: AI edits to an existing script are presented as a diff, never applied silently.

### 5.2 VOICE — `POST /api/reel/[slug]/voice`

1. Concatenate beat text into the VO script.
2. Higgsfield `generate_audio` with the pattern's `voice.higgsfieldVoiceId` -> `vo.mp3`.
   A creator's voice is cloned once via `create_voice` and the id stored in the pattern.
3. faster-whisper (CUDA, `word_timestamps=True`) over `vo.mp3` -> `vo.words.json`.
   The known script is passed as the initial prompt to improve alignment on product names.
4. Words are mapped back to beats by sequence, giving each beat a real start and end.

Re-runnable: changing beat text regenerates the whole track. Partial re-VO is out of scope for v1.

### 5.3 SHOTS — `POST /api/reel/[slug]/shots`

Per beat with no ready asset, route by `shot.kind` and pattern policy:

| shot.kind | default source |
|---|---|
| screen | ComfyUI image-to-video: user screenshot (or a captured page) animated into a 3-6s clip |
| broll | ComfyUI i2v; Higgsfield `generate_video` when the beat carries `shot.hero: true` |
| talking-head | user drop (recorded), else Higgsfield |
| title | no asset of its own — an overlay over the neighboring clip |

Rules:

- a user-dropped asset always wins over generation for that beat
- generation is asynchronous; `assets[].status` drives the studio's live-fill
- ComfyUI jobs go through the existing `lib/comfy/client.ts` against the Desktop instance on 8188,
  so they stay visible in the Desktop queue
- failed jobs surface in the studio with a retry button and an editable brief

`POST /api/reel/[slug]/assets` accepts user drops (multipart), probes them with ffprobe, and appends
to `assets[]`.

### 5.4 ASSEMBLE — `POST /api/reel/[slug]/assemble`

Pure function of (`beats`, `vo.words`, `pattern`, `seed`, locked elements). No network, no AI.

- **captions**: group words into beats of `pattern.caption.wordsPerBeat` words, respecting
  `maxChars` and clause boundaries; each caption spans its words' start..end
- **clips**: one clip per beat, bounded by the beat's word span, clamped into
  `pattern.pacing.shotSec`; long beats split into two clips on a word boundary; the talking-head
  anchor is re-inserted every `pattern.shotMix.anchorEverySec`
- **motion**: `pattern.motion.default` with the seeded RNG (`lib/rng.ts`) picking origin jitter and
  alternating zoom direction so consecutive shots do not move identically
- **transitions**: cycled from `pattern.transitions`
- **overlays**: hook title over the first `pattern.hook.durationSec`

Deterministic per seed — same inputs, same timeline.

### 5.5 STUDIO — `app/reel/[slug]/page.tsx`

```
+--------------+---------------------------+
|  9:16 player |  Beats / Shots / Caption  |
|  (DOM, live) |  panel (per-selection)    |
+--------------+---------------------------+
| timeline: clip strip + caption strip + waveform |
+------------------------------------------------+
```

**Player** is DOM, not a rendered file: stacked `<video>` / `<img>` layers, CSS transform for zoom and
pan, caption `<div>` styled by the pattern's `caption.css`, driven by one `requestAnimationFrame`
clock synced to `<audio src="vo.mp3">`. Scrubbing is instant; no encode wait. Assets appear as their
jobs finish (SSE from the shots route).

**Edit ops** (deliberately minimal, InShot-like):

- clip — trim in/out, split at playhead, reorder, delete, replace asset, regenerate shot with an
  edited brief
- motion — four presets (zoom in / zoom out / pan / hold) plus a strength slider; no keyframe editor
- caption — edit text, merge or split a beat, nudge start/end, hide
- global — pattern swap, seed, ratio, VO volume, music track and duck amount
- every op is undoable and marks the touched element `locked: true`

### 5.6 EXPORT — `POST /api/reel/[slug]/export` (SSE progress)

1. Playwright loads the pattern's `caption.css` and shoots each distinct caption and overlay as a
   transparent PNG into `renders/` (reuses `lib/renderer/capture.ts`'s browser singleton).
2. `lib/reel/ffmpeg.ts` builds one filter graph from the timeline: per-clip trim, scale/pad by `fit`,
   `zoompan` from the shared motion module, concat with transitions, `overlay` each caption PNG on its
   own `enable=between(t,a,b)` window, mix VO with ducked music.
3. Encode H.264 + AAC at the reel's ratio and fps.
4. `ffmpeg -progress` is parsed and streamed to the studio as a percent bar; the user keeps scrubbing
   the DOM preview while it encodes.
5. Write `export/caption.txt` (caption text + hashtags), same as paperbook's package step.

## 6. Preview/export parity

The one real architectural risk: a DOM preview and an ffmpeg export drifting apart. Handled by
construction, not by discipline:

- **One stylesheet.** `patterns/<name>/caption.css` is linked by the DOM preview and loaded by the
  Playwright overlay pass. There is no second caption style anywhere.
- **One motion module.** `lib/reel/motion.ts` takes a clip's `motion` spec and emits both the CSS
  transform used by the preview and the ffmpeg `zoompan`/`crop` expression used by the export. Neither
  side computes motion itself.
- **One timeline resolver.** `lib/reel/timeline.ts` answers "what is on screen at time t" for both
  sides.
- **A pixel test.** A 3-second fixture reel is exported, and frames at fixed timestamps are compared
  against Playwright captures of the preview at the same timestamps; per-pixel difference must stay
  under threshold.

## 7. Creator patterns

`patterns/<name>/pattern.json`:

```jsonc
{
  "name": "armand", "displayName": "Armand Segall",
  "caption": { "font": "Inter", "weight": 800, "sizeVh": 3.2, "case": "none",
               "fg": "#ffffff", "pill": "#000000", "pillAlpha": 0.85, "radiusVh": 0.9,
               "padVh": [0.5, 1.1], "yPct": 73, "wordsPerBeat": [1, 3], "maxChars": 22 },
  "pacing":   { "shotSec": [3, 6], "captionBeatSec": [0.4, 1.1], "cutOnWordBoundary": true },
  "hook":     { "layout": "title-over-broll", "durationSec": 1.6, "titleSizeVh": 6, "logoLockup": true },
  "shotMix":  { "talkingHead": 0.35, "screen": 0.45, "broll": 0.20, "anchorEverySec": 10 },
  "motion":   { "default": "zoom-in", "strength": 0.12 },
  "transitions": ["cut", "cut", "crossfade"],
  "voice":    { "higgsfieldVoiceId": "...", "rate": 1.0 },
  "letterbox": { "bg": "#ffffff" }
}
```

`pattern.json` values feed CSS custom properties; `caption.css` holds the actual styling, so a pattern
can go beyond what the JSON schema names. `hook.html` overrides the default hook overlay markup.

The reference reel analyzed above ships as the first pattern.

### Clone importer — `POST /api/reel/patterns/clone { mediaUrl }`

Offline analysis of a reference reel, producing a **draft** pattern:

1. `ffprobe` -> ratio, fps, duration
2. `ffmpeg scdet` -> cut timestamps -> `pacing.shotSec` distribution
3. faster-whisper on the audio -> transcript and word times -> `captionBeatSec`, `wordsPerBeat`
4. frame sampling plus row-wise difference over the lower third -> caption band `yPct`, pill color and
   alpha, text height -> `sizeVh`
5. first 3 seconds treated as the hook -> `hook.durationSec`, title size
6. writes `patterns/<slug>-draft/` plus a report separating measured values from guessed ones

Always a draft, always hand-editable. Reference reels come from the local media server
(`localhost:3000/api/media/...`), the same source as the analyzed Grok Bot reel.

## 8. Shared code and changes to existing files

New:

```
lib/reel/{schema,store,timeline,motion,assemble,ffmpeg,align,patterns,clone}.ts
lib/ai/reel/{plan,revise}.ts
lib/comfy/i2v.ts
lib/higgsfield/{client,voice,video}.ts
app/api/reel/**            app/reel/page.tsx  app/reel/[slug]/page.tsx
components/reel/{Player,Timeline,ClipPanel,CaptionPanel,ShotQueue}.tsx
patterns/armand/**
```

Modified:

- `components/AppShell.tsx` — enable the Reels nav item (drop `disabled` and the "soon" badge)
- `app/reels/page.tsx` — replaced by the real list at `app/reel/page.tsx`; the old route redirects
- `lib/graph.ts` and `lib/db.ts` — index reels alongside posts (new `reel` node kind)
- `app/dashboard/page.tsx` — Reels card becomes active with counts
- `lib/settings.ts` — reel defaults (fps, ratio, pattern, Higgsfield workspace, whisper model)

Paperbook code is not refactored. `lib/renderer/capture.ts`'s browser singleton is reused as-is by the
overlay pass.

## 9. Dependencies

| need | state |
|---|---|
| ffmpeg 9.0.1 | present on PATH |
| Playwright chromium | already installed for paperbook |
| faster-whisper + CUDA | **must install** — RTX 4090, word timestamps |
| Higgsfield MCP | available: `generate_audio`, `create_voice`, `generate_video` |
| ComfyUI image-to-video model | **must verify or download** before SHOTS works |

Degradation, matching paperbook's "app works without it" rule: no whisper means VOICE stops after TTS
and beats fall back to authored durations; no ComfyUI means shots stay queued and the studio still
plays whatever assets exist; no Higgsfield means TTS and hero shots are unavailable while user drops
still work.

## 10. Testing

- **Pure-function tests** for ASSEMBLE: fixed words and pattern produce expected clips and caption
  beats; seeded motion is stable across runs.
- **Lock preservation**: re-assemble after editing a clip leaves the locked clip byte-identical.
- **Parity pixel test**: 3s fixture reel, export frames vs. preview captures at matching timestamps.
- **ffmpeg graph test**: timeline to filter-graph string snapshot, plus one real 3s encode whose output
  ffprobes to the expected duration, fps and stream layout.
- **Clone importer test**: a short fixture video with known cut points and a known caption band yields
  a pattern within tolerance.
- **API smoke tests** for each route, mirroring paperbook's.
- **Schema validation** at every load and AI-edit boundary.

## 11. Out of scope (v1)

- keyframe animation editor, multi-track video, color grading
- automatic music-beat synchronization
- publishing or uploading anywhere (export folder only)
- background removal, green screen
- subtitle language variants or translation
- partial voiceover re-synthesis (whole-track regeneration only)
- stories, quote cards, memes

## 12. Key decisions log

| decision | choice |
|---|---|
| VO source | Higgsfield TTS with cloned creator voice; faster-whisper alignment after |
| Timing authority | word-level timestamps drive both captions and cuts |
| Compositor | ffmpeg filter graph; captions as Playwright-rendered transparent PNG overlays |
| Preview | live DOM player, not a rendered file — instant scrub, assets fill in as jobs finish |
| Parity guarantee | one stylesheet, one motion module, one timeline resolver, one pixel test |
| Video generation | ComfyUI image-to-video by default; Higgsfield for hero shots; user drops override both |
| Script input | three modes — topic/URL, pasted script, reference reel |
| Patterns | authored preset dirs plus a clone importer that drafts one from a reference reel |
| Editing model | autonomous first; minimal InShot-style ops; edited elements lock against re-assembly |
| Text rendering | HTML/CSS only — diffusion never renders text (inherited from paperbook) |
