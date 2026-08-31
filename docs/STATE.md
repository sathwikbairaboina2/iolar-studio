# Where iolar-reels stands

Last worked: 31 Aug 2026. Branch `feat/reel-build-boards` (off `feat/reels-engine`),
573 tests green, typecheck and `next build` clean. Lint unchanged at its
6 pre-existing errors.

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
