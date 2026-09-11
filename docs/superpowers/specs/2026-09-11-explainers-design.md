# Explainers: scripted concept animations rendered through the templates plugin

**Date:** 2026-09-11
**Branch:** `feat/one-branch`, in the worktree
`C:\Users\sathwik\projects\comfyui-projects\iolar-reels`.

## Goal

A fourth content category in the studio, beside handbooks, reels and jobs: short vertical
animations that explain one technical concept. A topic goes in, a deterministic mp4 comes out,
and the visual treatment is chosen from a dropdown rather than written into the content.

The category exists because the format is legible and repeatable. The reference channel
`@thestackframe` (35,755 followers, 24 posts between 4 August and 10 September 2026) publishes
nothing else: every post is a single animated diagram, no talking head, no b-roll, no voiceover.
Its top two posts carry roughly half of all views across the corpus, and both lead with a stated
cost delta rather than a topic name — `1 server 480 ms` against `+ load balancer 40 ms`, and
`Total moves = 2^5 - 1 = 31`. Posts that lead with a definition, at identical production quality,
land two orders of magnitude lower. That asymmetry is a design input, not a marketing note, and
it is why the op vocabulary in this spec treats side-by-side comparison and a ticking metric as
first-class rather than incidental.

## What already exists

Nothing here is built from nothing. Four pieces of the machine are already in place.

| Piece | Where | What it gives us |
| --- | --- | --- |
| Templates service | `main-reels-templates-plugin`, FastAPI on 26200 | JSON in, mp4 out, rendered with Remotion. Deterministic, CPU-only. |
| Service client | `lib/reel/pattern/service.ts` | `templates` / `validate` / `submit` / `job` / `log` / `download`, with `ServiceDown` and `ServiceRejected` already modelled. |
| Plugin registry | `lib/plugins/registry.ts` | The `templates` row, its health check and its Start button. No new entry needed. |
| Category pattern | `app/handbooks`, `app/reel`, `app/jobs` | Route plus API plus `lib/` module plus one `AppShell` menu entry. |

### The service is single-category today

The directory layout suggests categories are pluggable — `templates/<category>/template.json`
beside `render/src/templates/<category>/`. That is a convention, not an implemented abstraction.
Nothing has ever forced the seam to be real, because `tools` has always been the only category,
and the coupling to it runs the full depth of the service. Verified 2026-09-11:

| Where | State |
| --- | --- |
| `GET /templates` | **Already generic.** Scans the templates dir for any subdir holding a `template.json` and serves them all. A new category appears here with no Python change. |
| `GET /preview/{template}/{theme}` | **Route generic, body not.** Takes the category as a path parameter and 404s on an unknown one, but then calls `ReelDoc.model_validate` and `build_props`, both tools-shaped. |
| `api/reels_api/models.py:143` | `ReelDoc.template: Literal["tools"]` — the document model admits exactly one category by type. |
| `POST /jobs`, `POST /validate`, preview props | All three take `ReelDoc` directly. |
| `props.py` / `timing.py` / `fit.py` | Tools-shaped: 29, 13 and 5 attribute accesses on the document respectively. |
| `render/src/schema.ts` | `PropsSchema` is Hook/Slide/Page/Cta throughout. |
| `render/src/themes/index.ts` | The theme *registry* imports `ThemeComponents` from `../templates/tools/types`. |
| each `render/src/themes/<name>/` | Exactly `Hook.tsx Slide.tsx Page.tsx Cta.tsx` plus `tokens.tsx`. |
| `render/src/Root.tsx` | Hardcodes `tools-${theme}` composition ids and imports the tools samples. |

So adding `explainer` is a real extension of the service, not a drop-in. What is genuinely
reusable across categories is the token layer — bg, fg, muted, accent, font, mono, caption style —
and the job plumbing. Every section component is category-specific.

### Categories do not mix

`explainer` is a separate category inside the same service, and the tools stack is not
generalised to accommodate it. Sharing stops at plumbing that knows nothing about sections:
the job store's directory and state handling in `jobs.py`, the subprocess wrappers in
`renderer.py`, `assets.py` and `capture.py`, `config.py`, the worker queue and thread in
`worker.py`, and the HTTP app. Explainer gets job creation, polling, cancel and timeouts from
those, with no new port, no new daemon and no new registry row.

Everything that touches sections is per-category and never crosses: the contract, the document
model, the Remotion props schema, the compositions, the themes, and the timing/props/fit pipeline.

**Three dispatch points move**, and they are the seam rather than a violation of it.

1. `models.py` — `Literal["tools"]` becomes a discriminator over a registry of categories, or an
   explainer document cannot be accepted by type at all.
2. `render/src/Root.tsx` — a registry of `${category}-${theme}` composition ids instead of
   hardcoding `tools-`.
3. `Pipeline.run` in `worker.py` — an explainer is drawn, not assembled, so it branches to its
   own short pipeline method: props, render, timeline. No assets to fetch, no voice to probe, no
   presenter clip, no pages to capture. The tools body is unchanged rather than growing guards.

Corrected 2026-09-11, after the end-to-end render failed with
`AttributeError: 'ExplainerDoc' object has no attribute 'hook'`. The third point was missed
because the survey grepped for the type name `ReelDoc`, and `Pipeline.run` never mentions it —
it reads `doc.hook`, `doc.slides` and `doc.pages` off whatever `input_doc()` returns, and renders
a hardcoded `tools-{theme}` composition. A grep proved a claim it could not actually prove; only
reading the pipeline, or running it, could.

Beyond those three the tools stack is unchanged, and pattern reels keep rendering through the
path they use now.

Two operational notes for anyone adding a category. A Remotion composition renders its
`defaultProps` unless `--props` overrides them, so a still taken by composition id alone can
silently draw the wrong beat. And the renderer reuses a cached Remotion bundle, so a newly
registered composition id needs `RENDER_REBUILD=1` once, or the render fails with
`Could not find composition`.

## The seam

The studio never knows what a CDN edge looks like. The plugin never knows what a CDN is.

The script carries intent and data; the template turns that into pixels. One contract crosses
the line, fetched at runtime from `GET /templates`. This split is the whole design, and every
other decision below follows from it.

## The op vocabulary

A new category, `explainer`, declares its contract alongside `tools`:

```json
{
  "name": "explainer",
  "displayName": "Explainer",
  "sections": ["hook", "steps", "payoff", "cta"],
  "required": ["hook", "steps", "payoff"],
  "ops": {
    "stage":  { "requires": ["nodes"] },
    "send":   { "requires": ["from", "to", "label"] },
    "mark":   { "requires": ["node", "state"] },
    "meter":  { "requires": ["label", "to"] },
    "race":   { "requires": ["lanes"] },
    "reveal": { "requires": ["text"] },
    "panel":  { "requires": ["title", "lines"] }
  },
  "defaults": { "hook": 3, "step": 2, "payoff": 4, "cta": 3 },
  "limits": { "steps": 12, "nodes": 6, "label": 28, "line": 90 },
  "themes": ["glass-bento", "kinetic", "dashboard-bento", "sticker-board"]
}
```

The `ops` key is new. Everything else matches `tools/template.json` exactly, so the existing
`TemplateInfo` type and the existing `/templates` endpoint carry it with one field added.

`ops` is a map rather than a list because the studio needs something to author and pre-check
against. It names the required data keys per op, and nothing more. Validation is two-tier and the
tiers are not equal: the studio checks that the op exists and that its required keys are present,
which is enough to guide the model and to catch a malformed beat in the editor; the **plugin
remains the authority** on what the data actually means. `POST /validate` is a dry run that
returns the timeline or a 422, costs no render, and is what the studio calls before every submit.
Keeping deep shape knowledge out of the studio is what stops the seam leaking back.

| Op | Does | Drawn from |
| --- | --- | --- |
| `stage` | Declares the actors once | The boxes every flow reel opens on |
| `send` | A labelled thing moves between two declared nodes | API call, CDN, VPN, reverse proxy, OSI layers, WebSockets |
| `mark` | Highlights, dims or kills a node | A health check catching a dead server; a cache hit |
| `meter` | A number ticks to a value | 480 ms, 200 ms, 2 ms, move counts |
| `race` | Two lanes run the same job side by side | The load-balancer and caching posts, the two strongest in the corpus |
| `reveal` | Final text or formula lands | `2^5 - 1 = 31`; the one-line lesson |
| `panel` | Titled card, up to four lines, optional inline mono | The floor: any concept degrades to it |

### Ops are primitives, topics are data

This is the property that makes the category general rather than a set of hardcoded scenes.
`stage` does not know what a server is; it takes nodes:

```json
{ "op": "stage", "data": { "nodes": [
    { "id": "a", "label": "Working dir" },
    { "id": "b", "label": "Staging" },
    { "id": "c", "label": "Commit" } ] } }
```

Replace those labels with `Producer / Queue / Consumer`, or `Plaintext / Cipher / Key`, and the
same op and the same template code render it with no change anywhere. Whether the thing a `send`
moves is a packet, a token, a file or a stack frame is a string in the data.

Topics far outside the source corpus land on the vocabulary without special cases: Git merge
against rebase is a `race` and a `reveal`; a memory leak is a `meter` climbing with a `mark` on
the unreleased node; an OAuth handshake is a `stage` and four `send`s; a hash collision is a
`stage` of buckets, a `send`, and a `mark` on the clash.

### When a topic does not fit

Not every concept is a flow or a comparison. "Why is quicksort O(n log n) on average", "what is a
closure", "what does `volatile` mean" reduce to none of the first six ops. A system that pretends
otherwise renders confident nonsense. Three pieces close that gap.

**A planner step before authoring.** The model's first job is not writing beats. It is fitting
the topic to the *fetched* op list and stating, per beat, which op carries it. The fit is visible
and approvable before a frame renders.

**A floor op.** `panel` is deliberately generic, so an unfittable concept still produces an
honest, readable reel rather than a failure or a lie. It is the escape hatch that keeps the
vocabulary small instead of forcing one op per topic.

**A fit report.** Every script reports what fraction of its beats fell back to `panel`. An
all-`panel` script means the vocabulary does not cover this topic yet. That is information, not
an error: it says when a new op is worth building, driven by topics actually attempted rather
than by guesses made now.

### Deliberately deferred

`array`, `swap`, `pointer`, `push`, `pop` — the sorting and data-structure ops — are a second
category, `algo`, sharing the same envelope. Sorting and data-structure posts are a real part of
the reference corpus, so this category is expected, not hypothetical. It is still deferred: the
runtime-discovered contract means adding it later touches no studio code, and building two
categories before one has rendered a frame doubles the surface for no information.

## Script envelope

The plugin owns the op vocabulary. The studio owns a fixed Zod envelope, because the model needs
a stable target and the tests need something to assert against with the service down.

```
script.json
  slug, topic, template, theme, seed
  beats[]
    id
    role    hook | step | payoff | cta
    line    the on-screen text for this beat
    op      checked against the fetched contract, not against a studio enum
    data    checked for the required keys that contract names for that op,
            then sent to POST /validate, which is the authority
```

Only `op` and `data` are dynamic. Everything else is fixed and versioned in the studio.

## Pipeline

```
topic | reference mp4 | graph concept | blank
  -> FIT      planner maps the topic to the fetched ops, writes fit.json
              (per-beat op choice, panel-fallback ratio, approvable)
  -> SCRIPT   Claude writes script.json beats against the chosen ops
              diff-approve, the same gate handbook AI edits already pass
  -> RENDER   script.json -> POST :26200/jobs -> poll -> reel.mp4
  -> PACKAGE  export/reel.mp4 + caption.txt
```

`FIT` is a separate stage from `SCRIPT` on purpose. Fitting fails cheaply and legibly; a bad fit
caught there costs one model call instead of a render.

### The four inputs

All four converge on the same `fit.json`, then the same `script.json`. One authoring surface,
four doors.

- **Topic.** A string in, a planner pass out. The default path.
- **Reference reel.** A local mp4 or an Instagram URL. ffmpeg, already required by the plugin,
  pulls keyframes; vision reads beat structure and pacing; the planner writes a **fresh original**
  script on the same concept. This is the rule the handbooks reference-image path already
  enforces: read for structure, never copy content. The five reels pulled from `@thestackframe`
  on 2026-09-11 into `C:\Users\sathwik\projects\instascraper\downloads\thestackframe_0*.mp4`
  are the first fixtures.
- **Graph concept.** A Neo4j node on 3124 through `lib/knowledge`, feeding the planner the way a
  topic string does.
- **Blank.** An empty script, beats added by hand. This path earns its place beyond convenience:
  it is the only one that exercises the ops with no model in the loop, which is what makes the
  vocabulary testable offline.

### Caption

Captions are generated at package time from the approved beats — hook line, step walkthrough,
payoff — plus a tag set. In the reference corpus the posts that travelled carried structured
multi-line captions with a per-step breakdown; the posts that did not carried one sentence. The
material for the better shape is already sitting in the script, so this costs one template.

## Files

```
studio
  app/explainers/page.tsx                             list
  app/explainers/[slug]/page.tsx                      editor
  app/api/explainers/route.ts                         list, create
  app/api/explainers/[slug]/fit/route.ts
  app/api/explainers/[slug]/script/route.ts
  app/api/explainers/[slug]/render/route.ts
  app/api/explainers/[slug]/export/route.ts
  lib/explainer/schema.ts                             fixed Zod envelope
  lib/explainer/ops.ts                                validate op + data against the contract
  lib/explainer/fit.ts                                planner, panel-ratio report
  lib/explainer/ai.ts                                 the four input paths
  lib/explainer/store.ts                              slug CRUD
  lib/templates/service.ts                            moved from lib/reel/pattern/service.ts
  components/AppShell.tsx                             one menu entry under Create
  data/explainer/<slug>/{script.json,fit.json,renders/,export/}

plugin — new, all category-local
  templates/explainer/template.json                   contract
  templates/explainer/samples/*.json                  one sample per theme shipped
  api/reels_api/models_explainer.py                   ExplainerDoc, its sections and ops
  api/reels_api/props_explainer.py                    document -> Remotion props
  api/reels_api/timing_explainer.py                   section seconds -> timeline
  render/src/templates/explainer/index.tsx            the composition
  render/src/templates/explainer/types.ts             its own ThemeComponents
  render/src/templates/explainer/schema.ts            its own props schema
  render/src/templates/explainer/themes/<theme>/      its own section components

plugin — the two dispatch points, the only tools-side edits
  api/reels_api/categories.py                         name -> model, props, timing
  api/reels_api/models.py:143                         Literal["tools"] -> discriminator
  api/reels_api/routes/{jobs,templates,preview}.py    take the union, dispatch on template
  render/src/Root.tsx                                 registry of ${category}-${theme}
```

`registry.ts` in the studio is unchanged: the `templates` row already covers the service. No new
port, no new daemon, no new Plugins row.

`props.py`, `timing.py` and `fit.py` keep their current tools-shaped bodies and are reached only
through the registry. Nothing in them is rewritten to be category-aware, because the category
that needs different behaviour brings its own module instead.

### The one move in existing code

`lib/reel/pattern/service.ts` is the client for 26200 and is what explainers need, but it sits
inside the reel category and belongs to neither. It moves to `lib/templates/service.ts`, with its
13 import statements updated: 9 across source files, and 4 dynamic imports inside the single test
file `tests/reel.pattern.service.test.ts`. A rename with no logic change.

This touches files under `lib/reel/pattern/`. `feat/short-video` and `feat/reel-build-boards` are
held by other sessions, so the move should land as its own commit, ahead of any explainer code,
to keep it trivially revertable if those branches collide.

## Interface

Two screens, following `app/reel`'s shape.

The list shows thumb, topic, template and state. The detail page puts the beat list on the left
and a live preview on the right, through `GET /preview/explainer/{theme}?job={id}`. The route
itself already takes the category as a path parameter, so no new endpoint is needed — but its
body validates through `ReelDoc` and `build_props`, so it only serves explainer once those two
calls go through the category registry. Template and theme are dropdowns populated from
`GET /templates`, never from a studio constant.

The fit report sits above the beats as one line — *"9 of 11 beats fitted; 2 fell back to panel"* —
with the fallback beats flagged inline.

## Failure

| Case | Behaviour |
| --- | --- |
| 26200 down | `ServiceDown` already carries "start it from Plugins". Shown verbatim on the render button. Authoring and fit stay usable offline. |
| Document rejected (422) | `ServiceRejected` already maps FastAPI `loc`/`msg` to field paths. Each issue binds to its beat in the editor rather than printing a blob. |
| Contract drift | A saved script references an op a later contract no longer lists. Caught **on open**, not at render: the beat is flagged and offered a refit. |
| Render hangs or dies | The plugin kills at `RENDER_TIMEOUT_SEC`, default 900. The studio polling budget sits above that. `DELETE /jobs/{id}` is the cancel button. |
| ffmpeg absent | `GET /health` already reports which external tools were found. The reference-reel input disables itself with that reason shown; the other three doors stay open. |
| High panel ratio | Not an error. A report. |

Contract drift is the failure mode worth engineering for deliberately: it is the price of a
runtime-discovered vocabulary, and catching it at open rather than at render is what keeps that
price small.

Polling runs at 2s while a job is live and stops when the page unmounts. No poller outlives the
tab.

## Verification

**Offline unit tests.** `ops.ts` validates against a checked-in fixture copy of `template.json`,
so the entire authoring layer tests with 26200 down. This is the trick
`tests/reel.pattern.service.test.ts` already uses with a mocked fetch.

**Golden tests on the timeline, not the pixels.** The repository golden-tests handbook PNGs
byte-for-byte, but mp4 bytes are a bad contract: encoder version churn breaks them for no signal.
The plugin already returns a deterministic `timeline.json` from both `POST /validate` and
`GET /jobs/{id}/timeline.json`. That is what gets golden-compared. It is the thing that must stay
stable, it diffs readably, and checking it needs no render.

**One real render per category in e2e**, skipped when 26200 is not answering, matching
`tests/reel.pattern.e2e.test.ts`.

**A blank-path fixture**: a hand-written script covering all seven ops, rendered once per theme.
That is the regression net for the plugin half.

**The tools suite stays green, unchanged.** The two dispatch edits are the only tools-side code
this work touches, and the plugin's existing `api/tests/` suite — `test_models.py`, `test_props.py`,
`test_timing.py`, `test_fit.py`, `test_jobs.py`, `test_preview.py`, `test_e2e.py` — is what proves
they changed nothing observable. Those tests run before the discriminator lands and again after,
with no edits to them. A test that needs modifying to keep passing means the change was not the
minimal dispatch move it was supposed to be, and that is the signal to stop and reconsider rather
than to update the test.

## Resource cost

Renders are Remotion and headless Chromium: CPU and RAM, no GPU, so they do not contend with
ComfyUI for VRAM. One already-registered service, no new daemon, nothing left running after a
render returns.

## Out of scope

- **Generalising the tools stack.** Considered and rejected on 2026-09-11. Making categories a
  real abstraction across `models.py`, `schema.ts`, the theme registry and `Root.tsx` would be
  the principled refactor, but it puts a service that pattern reels depend on at risk in order to
  serve a vocabulary that has never rendered a frame. Explainer brings its own stack instead, and
  the tools stack is left as it is.
- The `algo` category and its ops.
- Voiceover. The reference format is silent text-on-screen; `lib/reel` owns TTS and alignment
  and none of it is needed here.
- Publishing. Export writes a file; posting stays manual.
- A bridge to the instascraper recreate queue on 8000. The reference-reel input takes a path or a
  URL, which is enough to start; wiring the queue is a later decision.
