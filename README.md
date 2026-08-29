# iolar studio

Local studio for Instagram content. Two categories are built: **paperbook**, handwritten-notes
carousels rendered from structured JSON, and **reel**, scripted vertical video assembled from a
voiceover and generated shots. Three more (stories, quote cards, memes) are scaffolded.

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
data/paperbook/<slug>/post.json        # single source of truth (editable by hand, UI, or AI)
data/paperbook/<slug>/renders/         # slide-NN.png + render-report.json (+ polished/)
data/paperbook/<slug>/export/          # final package
data/settings.json                     # brand, defaults, comfy url/checkpoint
assets/doodles/                        # ComfyUI-generated sketch assets
```


## Reels

`data/reel/<slug>/reel.json` is the single source of truth for a reel; six re-runnable stages
fill it in.

```
topic / pasted script / reference reel
  -> PLAN      Claude writes beats (hook/body/close) + a shot brief per beat, in a creator's voice
  -> VOICE     Higgsfield TTS -> vo.mp3, then whisper word timestamps -> vo.words.json
  -> SHOTS     per beat: ComfyUI image-to-video by default, Higgsfield for hero shots,
               your own dropped files override both
  -> ASSEMBLE  word timings + creator pattern -> clips, karaoke captions, hook overlay (seeded)
  -> STUDIO    watch and edit it in the browser while shots are still generating
  -> EXPORT    ffmpeg -> export/reel.mp4 + caption.txt
```

The **word timings are the timing authority**: captions and cuts both hang off them, so the
edit lands on the voiceover rather than near it.

### Preview and export cannot drift

The studio plays the timeline in the DOM (instant scrub, no encode) while ffmpeg renders the
same timeline. They stay identical by construction, not by discipline:

- one stylesheet — `patterns/<name>/caption.css`, linked by the preview and loaded by the
  export's Playwright pass
- one motion module — `lib/reel/motion.ts` emits both the CSS transform and the ffmpeg
  `zoompan` expression from the same spec
- one timeline resolver — `lib/reel/timeline.ts` answers "what is on screen at t" for both
- one pixel test — `tests/reel.parity.test.ts` exports a reel and asserts the caption lands on
  the same pixels the preview paints

### Editing is a pass over finished work

The studio is autonomous first: everything you see was assembled without you. Edits are
deliberately few — trim, split, reorder, delete, four motion presets, caption text and nudge.
Anything you touch is marked `locked: true` and survives re-assembly untouched while the rest
reflows around it.

### Creator patterns

A pattern is `patterns/<name>/`: `pattern.json` (caption geometry, pacing, hook, shot mix) plus
`caption.css` (the real styling; the JSON only feeds CSS custom properties) and an optional
`hook.html`.

`POST /api/reel/patterns/clone { mediaUrl }` drafts one from a reference reel: it measures cut
rhythm with `ffmpeg scdet`, finds the caption band by shape (short, centred, not full-width, so
a white screenshot behind the text is not mistaken for it), and counts how often that band
changes to get the beat rate. It writes `patterns/<name>-draft/` with a report separating what
was measured from what was guessed. Always a draft — read it before you trust it.

### Requirements

| need | note |
|---|---|
| ffmpeg + ffprobe | on PATH; the export and every measurement go through them |
| Playwright chromium | shared with paperbook |
| whisper | `npm run setup:whisper` (openai-whisper: PyAV, which faster-whisper needs, is blocked by Windows Application Control on this machine). CPU by default; the setup script prints the CUDA install line |
| Higgsfield | reached through the `claude` CLI's MCP tools — the app borrows a Claude session for TTS and hero shots |
| ComfyUI | image-to-video via the bundled MiniMax H3 template, `lib/comfy/workflows/i2v.template.json` |

Every one of these degrades rather than crashes: no ComfyUI leaves shots `awaiting-manual` for
you to drop in, no whisper stops VOICE after the audio is saved, no Higgsfield disables TTS and
hero shots while your own files still work.
