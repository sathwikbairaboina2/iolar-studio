# Where iolar-reels stands

Last worked: 30 Aug 2026. Branch `feat/reels-engine`, working tree clean,
490 tests green across 60 files (ffmpeg and e2e suites excluded — they run real
encodes). Typecheck, lint and `next build` all clean.

## Run it

```bash
npm run dev -- -p 3120          # studio (3100 belongs to IntaBot per _devkit/PORTMAP.md)
docker compose -f agent/compose.yml up -d   # the local edit agent, port 3121
```

Needs: ComfyUI on 8188, Ollama on 11436 holding `lfm2.5`, `claude` on PATH.

## What was built this session

**1. Preview playback fix** — `components/reel/Player.tsx`
The playback effect listed `onTimeChange`/`onEnded` in its deps and the studio
passes a fresh arrow each render, so every frame tore the clock down and
re-seeded it. The voiceover ran at roughly a quarter speed. Callbacks now go
through refs.

**2. Server-authoritative command layer** — `lib/reel/{commands,history,bus}.ts`
Every edit is a named command. `edits.ts` stays pure and untouched, so preview
and export cannot drift. Snapshot history with server-backed undo (50 deep);
an in-process SSE bus pushes the reel to open tabs. Rejections name the valid
ops / ids / schema, because an agent is a first-class caller.

Ordering that matters: the reel is saved *before* the log is appended, so a
failed history write costs a log line rather than the edit — which is why
`history.push` is handed the previous reel instead of reading disk.

**3. Local agent that proposes edits** — `agent/` (Python, LangGraph, port 3121)
`settings.agentProvider` swaps between `local` (lfm2.5 via Ollama 11436) and
`claude`. The agent proposes; it never writes. Apply is a separate call.

Model chosen by measurement, recorded in the spec: lfm2.5 at 5.2GB answers in
1–2s and leaves the 4090 free for ComfyUI, where qwen3.6:27b leaves 842MB.
gemma4:12b emitted a well-formed command to *lengthen* a clip the request
called too long — which is why propose-then-approve exists.

**4. Draggable timeline** — `components/reel/Timeline.tsx`
Was sized by clips alone, so a 12.1s caption on a 7.86s lane sat at 154% and
pushed the page 1175px sideways. Now spans clips, captions and voiceover, and
scrolls in its own box. Lanes memoised so a playhead tick does not re-render
twenty blocks. Clips reorder, edges trim, cue bars retime — one command per
gesture, on pointer-up.

**5. Research workflow** — `lib/reel/research/`, `components/reel/ResearchPanel.tsx`
Topic → brief (5 questions) → hunt → critic → review gate → gather → script →
approve gate. The Research tab in the studio. Runs through `runClaude`, the
same headless CLI that writes the beats.

## Where to pick up

**The research flow has never been run end to end on a live topic.** Every
stage is unit-tested and the routes are contract-tested, but a real run costs
several minutes of Claude time and has not been done. That is the next thing
to do, and the most likely place to find problems.

Specifically unproven:
- whether the critic reliably returns candidates matching `CandidateSchema`
  (the prompt now embeds the generated JSON schema, but no live run has
  confirmed the model honours it)
- whether `gatherEvidence` copes with real pages at scale
- whether a drafted script's citations land on ids that actually exist

**Deliberately not built:** anything past an approved script. No clip building,
no asset generation from research, no bridge from `script.json` into
`planFromScript`. The user drives that.

## Sibling: reelscout

`C:\Users\sathwik\projects\plugins\reelscout` — the standalone research plugin
this was ported from. Still works, still on 3100, `master` clean, 166 tests.
Its `/reel` command does the same workflow in Claude Code.

The two are **copies, not a shared library**: reelscout is on zod 3, instastudio
on zod 4, and `z.record()` changed signature between them. Fixes to the shared
logic (`script.ts`, `gather.ts`, `scriptBoard.ts`) have to be applied twice.

Left behind in reelscout: a hand-written demo `script.json` in
`runs/ltx-video-open-weights-20260830-2140/`, created to screenshot the review
screen. It is not a real run output. Delete it and set that brief's status back
to `critiqued` when it stops being useful.

## Specs

- `docs/superpowers/specs/2026-08-30-reel-editor-command-layer-design.md`
- `docs/superpowers/specs/2026-08-30-local-agent-editor-design.md`
- `../../plugins/reelscout/docs/superpowers/specs/2026-08-30-reel-workflow-design.md`
