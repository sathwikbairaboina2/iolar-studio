# iolar reels — from approved script to rendered clips, on two job boards

**Date:** 2026-08-31
**Status:** Approved design, pending implementation
**Location:** `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`
**Branch:** `feat/reels-engine`
**Builds on:** `2026-08-30-reel-editor-command-layer-design.md`, and the research
workflow shipped in `lib/reel/research/`

## 1. Purpose

The research workflow ends at an approved script and stops there deliberately. This
spec is what happens next: the user hands over a voiceover file, and the studio turns
the approved script into rendered clips using two plugins the user built.

Nothing here generates content of its own. Both renderers are the user's; the studio
routes work to them, tracks it, and drops the results into the editor that already
exists.

**The evidence becomes the footage.** Every factual line already carries citations, and
each candidate holds `canonicalUrl` and `pullQuotes`. `webpage-mp4-plugin` takes exactly
`url` + `highlight`. So the shot for a cited line is a phone browsing that source page
with the marker sweeping the quote that proves it. The research was already doing this
work; it was only ever displayed as a chip in a review panel.

## 2. The two plugins

Read before designing, not assumed.

### 2.1 `webpage-mp4-plugin` (`C:\Users\sathwik\projects\webpage-mp4-plugin`)

Node 20, Playwright + ffmpeg. Renders a vertical phone-browsing clip per link: flick
scrolling with momentum, a finger indicator, reading pauses, an accent marker sweeping a
named phrase, and a push-in for readability.

- HTTP: `POST /v1/jobs`, `GET /v1/jobs/:id`, SSE `GET /v1/jobs/:id/events`,
  `GET /v1/jobs/:id/clips/:slug`, `/manifest`, `/review`, `/stills`.
- Per-link fields: `url`, `highlight`, `segment`, `audio`, `dwell`, `color`.
- `audio` duration **sets that page's screen time** and is muxed into the clip.
- Ships a review pass that inspects the output rather than trusting it.

### 2.2 `comfYUI-plugins` — lipsync desk closeup (`C:\Users\sathwik\projects\comfYUI-plugins`)

Wan 2.2 S2V-14B through ComfyUI's native audio-to-video nodes. Reference image + audio
→ closeup of a person at a desk speaking it, with matched lips and idle motion.

- FastAPI + redis + SQLite: `POST /jobs` (202), `GET /jobs/{id}`, `GET /jobs/{id}/result`,
  `/queue`, `/healthz`, `/types`.
- Targets **ComfyUI Desktop on `:8189`** — *not* the `:8188` docker instance, which
  belongs to ComicGen and has none of these models.
- `-Fast` swaps in a 4-step distill LoRA, roughly 5x faster.

## 3. What the user supplies

Two inputs, both unavoidable:

1. **One voiceover file per reel.** The whole script, not per line.
2. **One presenter image**, stored in settings and reused. Neither the research nor the
   script can invent it, and lipsync cannot run without it.

## 4. The bridge: script lines to beats

The research produces **lines**; the reel is made of **beats**. There is no bridge today,
by choice. This adds one, and it reuses what exists:

- `planFromScript(slug, script)` already turns a script into beats with `role` and
  `shot.kind`.
- `wordingDrift(script, beats)` already refuses beats that reworded their source. An
  approved script that the planner paraphrases is no longer the approved script, so this
  guard is the reason the bridge is safe to automate.

**The planner's palette is constrained** for a researched reel to `title`,
`talking-head` and `screen`. `broll` is excluded because neither plugin makes generic
b-roll; constraining the palette means every beat has a renderer by construction and the
reel finishes without a human dropping files in.

### 4.1 Schema change

`ShotSchema` gains `sourceLineId: string | null`.

A `screen` beat needs a URL and a phrase, which live on the *line's* citations. Carrying
the line id is what lets a beat resolve back to its evidence. It is nullable because
beats planned from a topic have no line behind them.

## 5. Audio: one file, sliced by alignment

Already supported and unchanged: `voiceProvider: 'manual'`, and the voice route's
`alignOnly` flag calling `alignExistingVoice`, which runs whisper and stores word
timings on the reel.

New work is only the slicing:

1. User uploads `vo.mp3` on the Build board.
2. `alignOnly` produces `reel.vo.words`.
3. `beatSpans(reel)` (exists, `assemble.ts`) turns those into per-beat start/end.
4. ffmpeg cuts one audio file per beat into `assets/audio/<beatId>.wav`.

Each renderer gets exactly its beat's audio. For `webpage-mp4` that also sets the clip's
duration, so a page is on screen for exactly as long as its line is spoken — the
alignment does double duty.

## 6. Routing

| Beat kind | Renderer | Input |
|---|---|---|
| `screen` | `webpage-mp4` | `url` + `highlight` from the beat's line citations; `audio` = beat slice |
| `talking-head` | lipsync | presenter image; `audio` = beat slice |
| `title` | none | overlay, never queued — as today |

Resolving a `screen` beat's link: take the line's citations, pick the highest
`scoreTotal` candidate, use its `canonicalUrl` as `url` and its first `pullQuotes[].text`
as `highlight`, falling back to the line text when the candidate has no pull quote.

**`GENERATABLE` inverts.** `screen` was excluded because diffusion melts text; that
reasoning does not apply to a real browser rendering a real page, so `screen` becomes the
best-served kind and `broll` leaves the list.

### 6.1 The provider seam widens to a router

`lib/reel/videoProvider.ts` holds one provider. It becomes a registry keyed by renderer
name, with the same contract per entry:

```ts
interface VideoProvider {
  readonly name: string;
  available(): Promise<boolean>;
  animate(req: AnimateRequest): Promise<{ jobId: string }>;
  jobState(jobId: string): Promise<JobState>;
  collect(jobId: string, dest: string): Promise<void>;
}
```

`AnimateRequest` gains the fields a page visit needs (`url`, `highlight`, `audioPath`)
and `imagePath` becomes optional, because the two renderers want different things.
`refreshShots` polls whichever provider owns each running asset, which is why the asset
already carries `jobId` — it now also carries the provider name.

Two adapters, `lib/reel/providers/webpage.ts` and `lib/reel/providers/lipsync.ts`, each
a thin HTTP client against the APIs in §2. Neither plugin is modified.

## 7. The boards

Three surfaces, not one stage inside Research. The render jobs are long, they fail in
their own ways, and they deserve to be watched rather than hidden behind a step rail.

### 7.1 Build board (new tab)

Owns the bridge and the audio. Upload the VO, run alignment, see the beats the planner
produced with the renderer each one resolved to and the link a `screen` beat will visit.
One button queues everything. This is the only place the reel is assembled from an
approved script.

### 7.2 Pages board (new tab)

One row per `webpage-mp4` job: beat, url, highlight phrase, dwell, job state, the
plugin's own review verdict, and a still. Retry re-submits a single row. The review pass
is surfaced here rather than swallowed: a clip that fails its own review is marked
`failed`, not shipped quietly.

### 7.3 Presenter board (new tab)

One row per lipsync job: beat, audio length, queue position from `/queue`, progress, and
the finished clip. Long renders belong on their own board because a 14B S2V job is
minutes, and the queue depth matters to whoever is waiting.

Both job boards poll their plugin, write results into the reel's assets through the
existing command layer, and never mutate the reel directly.

## 8. Failure handling

- **Plugin unreachable** — beat goes `awaiting-manual` with the message naming which
  plugin, exactly as the seam does today. A dropped file still finishes the reel.
- **A single job fails** — that asset is `failed` with the plugin's error; the others are
  untouched. This is the same lesson the research stages learned three times: one bad
  unit must not cost the batch.
- **Review fails** — `failed` with the review's own words, retryable from the Pages board.
- **No citation on a `screen` beat** — resolved as `awaiting-manual` rather than guessing
  a URL. A page visit with no source is exactly the fabrication the research exists to
  prevent.
- **Alignment unavailable** — the VO is kept and the beats stay unqueued; whisper missing
  must not lose the upload.

## 9. Ports

Allocated through `_devkit/PORTMAP.md`, not guessed. Required:

| Service | Port | Notes |
|---|---|---|
| studio | 3120 | existing |
| `webpage-mp4-plugin` | 8080 | its default; needs `shm_size: 1gb` under docker |
| lipsync API | 8300 | `API_PORT` in `lipsync_api/config.py`; brings its own redis on 6379 loopback |
| ComfyUI Desktop | 8189 | **not** 8188 |

## 10. Testing

- **Bridge** — an approved script produces one beat per line, wording preserved, palette
  constrained, `sourceLineId` set. A planner that paraphrases is refused.
- **Slicing** — word timings cut into per-beat audio whose durations sum to the VO.
- **Routing** — `screen` resolves to its top-scoring citation's url and pull quote; a
  citationless `screen` beat goes `awaiting-manual`.
- **Adapters** — both mocked at the HTTP boundary: submit, poll, collect, and each
  failure mode in §8.
- **Boards** — node-level logic tests as `scriptBoard.ts` did, since the vitest config
  covers `.test.ts` and component tests are not set up.

No test calls a real plugin. The live run is the proof, as it was for research.

## 11. Phases

Each phase is useful on its own and verifiable before the next begins.

1. **Bridge and audio** — `sourceLineId`, the constrained planner call, VO upload,
   alignment, per-beat slicing. No plugin is involved, so it is fully testable and
   provable on the five approved scripts already on disk.
2. **Adapters and router** — the two HTTP clients, the widened seam, `refreshShots`
   polling per provider. Driven by the API and tests; a reel can be built headless.
3. **Boards** — Build, Pages, Presenter. The watching surfaces, once there is something
   real to watch.

## 12. Explicitly not in scope

- Modifying either plugin.
- `webpage-mp4`'s own stitched `reel.mp4` — the studio's timeline, patterns, captions and
  export do assembly, and the plugin's stitcher cannot know about them. Per-link clips
  only.
- Generating a presenter image.
- Any TTS. The voice is the user's file.
