# Where iolar-reels stands

Last worked: 31 Aug 2026. Branch `feat/reel-build-boards` (off `feat/reels-engine`),
573 tests green, typecheck and `next build` clean. Lint unchanged at its
6 pre-existing errors.

## Reel patterns (3 September 2026)

A reel may carry a **pattern**: its approved research script is split into a template's
sections (`reel.pattern.sections`, script line ids plus on-screen copy), voiced from the
script lines, given a presenter clip (lipsync over the hook's audio, or an uploaded
`presenter.mp4`), and rendered by `main-reels-templates-plugin` on **26200** into
`export/reel.mp4`. Beats are not involved; freeform reels are unchanged. The first pattern
is `tools`; a second is one `PatternDef` in `lib/reel/pattern/` plus a template in the
service — names, themes, limits and default seconds are read from `GET /templates`.

The creator preset formerly called `pattern` is now `style` (`reel.style`, `styles/armand/`,
`/api/reel/styles`, setting `reelStyle`); old files migrate on read.

Stages, derived from disk by `lib/reel/pattern/run.ts`: `unsectioned → sectioned → voiced →
aligned → presented → rendering → failed | done`. Routes: `GET /api/reel/patterns`,
`GET|POST /api/reel/[slug]/pattern`, `POST .../pattern/{section,advance,render}`,
`GET|PUT|DELETE .../presenter`. The Pattern tab (`components/reel/PatternBoard.tsx`) drives
it and embeds the service's own preview page. The service must be running (Plugins card,
`reels-templates`).

Opt-in end to end: `RUN_E2E=1 E2E_PRESENTER=C:/x/take.mp4 E2E_VO=C:/x/vo.mp3 npx vitest run tests/reel.pattern.e2e.test.ts`.
Design: `docs/superpowers/specs/2026-09-03-reel-patterns-design.md`.

## Run it

```bash
npx next dev --webpack -p 3120   # --webpack is required, see below
```

**`npm run dev` does not work on this machine.** An Application Control policy
blocks `@next/swc-win32-x64-msvc`, Next falls back to WASM, and Turbopack refuses
to start on WASM bindings. Use `--webpack`.

Needs on PATH / up:

| Service | Port | Notes |
|---|---|---|
| `webpage-mp4-plugin` | 8080 | page shots; queue caps at 32 waiting, one slot |
| lipsync API | 8300 | talking-head shots; brings its own redis |
| ComfyUI | 8188 | what the lipsync API is actually pointed at |
| Ollama | 11436 | `lfm2.5`, for the edit agent only |
| `claude` | — | research and planning both shell out to it |

## What this branch adds

An approved script now becomes a finished reel without a human in the middle.

```
approved script
   └─ planFromScript (paste mode; wordingDrift refuses a paraphrase)
        └─ beats, each carrying shot.sourceLineId
   └─ voice: synthesised locally, or the file you upload
        └─ whisper alignment → word timings → one wav per beat
   └─ routed per beat kind
        screen        → webpage-mp4   (the page its line cites, sweeping the pull quote)
        talking-head  → lipsync       (presenter image + that beat's audio)
        title         → overlay, never queued
   └─ clips land as assets → timeline → export
```

**The join that makes it worth doing:** a cited line already knows its source's
canonical URL and pull quotes, and `webpage-mp4` wants exactly a url and a
phrase. So a page shot is the evidence for that sentence, on screen, with the
marker on the words that prove it.

Key modules: `lib/reel/build/{bridge,audio,links,run}.ts`,
`lib/reel/providers/{webpage,lipsync}.ts`, `lib/reel/videoProvider.ts` (a registry
keyed by renderer name), and three boards — Build, Pages, Presenter.

Design: `docs/superpowers/specs/2026-08-31-reel-build-boards-design.md`.

## Proven end to end

`webgpu-ships-everywhere`: approved script → 14 beats → synthesised voice →
alignment → 14 audio slices → 8 page shots + 6 lipsync shots → assembled →
`export/reel.mp4`, 61.7s. GPU peaked at 23.7 of 24.5 GB.

## What bit, and what now guards it

Worth reading before changing any of this — each of these was silent.

- **The palette instruction never reached the prompt.** An edit failed without
  saying so, the planner kept being told b-roll was allowed, and beats came back
  that nothing could render. `coerceKinds` is the guarantee; the prompt is the
  request.
- **The renderers were registered by importing a module the collecting route did
  not import.** Every finished job stayed `running` for ever, silently.
- **Replacing a voiceover left the old word timings**, so the build skipped
  alignment and cut every beat on the previous take.
- **`scriptText` read array order, not `line.order`** — when those disagree every
  beat cites the wrong line.
- **One unreachable plugin took down the whole refresh**, losing the finished
  clips of the renderer that was up.
- **`done` meant "nothing running"**, so a reel where every shot failed reported
  success. There is a `stalled` stage now.
- **Building several reels at once earns 429s.** `webpage-mp4` holds 32 waiting
  and runs one at a time. Build one reel at a time.

## What the plugins themselves refused

Found by running fifteen reels through them, not by reading the code.

- **Wan S2V rejects certain audio lengths.** A 6.76s slice fails with
  `einops: can't divide axis of length 14040 in chunks of 7`; the same beat at
  6.40s renders. It is the 77-frame window maths in `plan_chunks`, and it hit two
  reels out of fifteen. Trimming the slice is the workaround; the real fix is
  either rejecting the duration up front or padding it to a window boundary.
- **`webpage-mp4` answers 429 at 32 queued.** It runs one job at a time, so
  building several reels at once just burns beats. Build one reel at a time.
- **Export died with `spawn ENAMETOOLONG` past about forty beats.** Windows caps
  a command line at 32k characters and the filter graph alone runs past it. The
  graph now spills to `filter.txt` and is passed as `-/filter_complex` —
  `-filter_complex_script` was removed in ffmpeg 7, and this box runs 9.0.1.

## Fifteen reels, built unattended

`data/reel/<slug>/export/reel.mp4`, 54–112s each, voice synthesised locally with
kokoro and aligned by whisper. Research, script, beats, audio, both renderers,
assemble and export ran without a human in the loop, driven through the same
HTTP API the studio uses.

## Where to pick up

- **`the-s-in-sbom` fails `wordingDrift` repeatedly.** The planner keeps
  paraphrasing that script. The guard is right; the retry is not persistent
  enough. Worth deciding whether a third attempt should relax the split rather
  than the wording.
- **Beat counts vary wildly** — 6 approved lines became 14 beats on one reel and
  43 on another. The pacing prompt is not holding.
- **`useStillsForScreens` only runs when no page renderer is wired.** If you ever
  want dropped screenshots to win over a page shot, that rule needs revisiting.
- Nothing bridges an approved script into a *second* pass — re-bridging replans
  from scratch and re-queues every shot.

## Sibling: reelscout

`C:\Users\sathwik\projects\plugins\reelscout` — the standalone research plugin
this was ported from, still on 3100. The two are copies, not a shared library:
reelscout is on zod 3, instastudio on zod 4. Fixes to `script.ts`, `gather.ts`
and `scriptBoard.ts` have to be applied twice.


## Knowledge layer (2 Sep 2026, branch `feat/knowledge-layer`)

Neo4j and Qdrant in `docker/compose.yml`, volumes on `D:\iolar`. Bring up: `npx tsx scripts/knowledge-env.mts && docker compose -f docker/compose.yml up -d`, or Start on the Plugins page. Ports 3124 bolt, 3125 browser, 3126 qdrant http, 3127 grpc. Rebuild everything from disk and the jobs board: `npm run reindex:knowledge -- --wipe` (about 8 minutes, embeds on research-ollama :25103). Tests never touch the real stores (`tests/setup.ts` installs the fakes); `KNOWLEDGE_LIVE=1 npx vitest run tests/live/knowledge.live.test.ts` proves the drivers. `knowledgeMemory: false` in settings turns agent recall off. Graph page: `/graph`, four tabs. Feature list: `/about`.


## Jobs bridge (2 Sep 2026)

The Jobs tab runs one loop: **pull** research-plugin's India pool (`POST /api/jobs/pool/pull`, pages of 200 up to its `total`) into `jobs_pool`; **prepare** a cut for the ISO week or the day (`POST /api/jobs/cuts {kind}`) which maps rows with `lib/jobs/map.ts` (rules, then one qwen call for the leftovers), computes the reel's tiles with the ported `summarise`, fetches the brief from `POST /api/jobs/brief`, and flags cuts under 20 rows as thin; **submit** (`POST /api/jobs/cuts/{id}/submit {force}`) posts `jobs.json` + `brief.md` to the board's new `POST /api/weeks/{key}/jobs`, then `summarise` and `plan`. Ledger tables: `pulls`, `jobs_pool`, `cuts`, `cut_rows`, `submissions` in `data/iolar.db`. A period the board already exported needs force. Schema parity with the plugin is a test that runs the plugin's own `tsx` (`tests/jobs.reelSchema.test.ts`). First live cut: 2026-W36, 102 rows, 95 by rule, 7 by qwen, planned on the board.


## Audio sync (2 Sep 2026, jobs-reel-plugin `master` ab9cef9)

Slides are cut to the voice: `lib/voice/fit.ts` makes each spoken beat 0.25 s lead + line + 0.6 s pad, floored per role, on the frame grid; the reel is the sum (35–75 s). Per-beat Piper lines in `weeks/<w>/vo/`, laid with `adelay` into `vo.mp3`. Music: `npm run music:bank` generates 70 s instrumentals per style with ComfyUI's ACE-Step 1.5 turbo checkpoint (in the comicgen container on :8188, models under `projects/ComicGen/comfyui/models`); `lib/audio/mix.ts` ducks the bed under the voice and normalises to -14 LUFS into `audio.wav`. Board: `/music`, week audio panel, `/api/weeks/{w}/audio`. Studio: Audio column on the Jobs table. W36 rebuilt at 48.7 s with `paper-doodle/1.mp3`. Only paper-doodle has a bank so far; run the bank for the other ten styles before rotating.

## Studio submits list and voice (3 Sep 2026)

Submit on a cut now runs the whole hand-off: list, summarise, plan in `settings.jobsStyle`, plugin script, studio recordings (kokoro, then piper, mastered) posted to `POST /api/weeks/{w}/script`, then `build` detached on the board. Cut statuses: submitted, summarised, planned, scripted, voiced, building. The Jobs tab's Request formats tab renders `GET /api/styles` from the plugin: per style, its world, its beats, and the three request bodies. Plugin fixes from the W36 review: world-aware urgency fallback with no duplicate scene, freshness (`fresh-posts`) as the urgency fact, `stat-cities` for the classic map, the prompt names what each slide shows, captions above world punchlines and grouped on phrases, render cache on pass two, Piper pacing per role with sentence pauses and -16 LUFS, a doctor step before every build, `npm run showcase` and `/showcase` on the board.

