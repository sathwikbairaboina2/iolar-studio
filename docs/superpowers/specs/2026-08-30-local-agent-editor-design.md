# iolar reels — local LangGraph agent driving the editor

**Date:** 2026-08-30
**Status:** Approved design, pending implementation
**Location:** `C:\Users\sathwik\projects\comfyui-projects\iolar-reels`
**Branch:** `feat/reels-engine`
**Builds on:** `2026-08-30-reel-editor-command-layer-design.md` (phase 3 of that spec)

## 1. Purpose

Let an agent edit a reel from a plain-English request — "the captions drift after 20s, fix them" —
running entirely on this machine, with a settings toggle to swap the brain between a local model and
Claude.

This is phase 3 of the editor spec, with one substitution: the second client of the command layer is a
local agent service rather than an MCP server. Nothing in the command layer changes to accommodate it,
which was the point of building that layer first.

**The agent proposes; it never writes.** Every run returns a command list you review and Apply. That is
not caution for its own sake — see the measurements in §2, where a candidate model emitted a
well-formed command that did the exact opposite of the request.

## 2. Model selection, measured

Every candidate got the same probe: two tools (`clip_trim`, `caption_nudge`), one request — *"Clip c3
runs half a second too long, and caption k2 is 0.2s late."* Correct answer:
`clip_trim{c3, out, -0.5}` and `caption_nudge{k2, -0.2}`.

| Model | VRAM | Protocol | Values | Warm latency |
|---|---|---|---|---|
| **lfm2.5** (8.5B, Q4_K_M) | **5.2GB** | tool_calls | both exact | **1-2s** |
| qwen3.6:27b | 17.3GB | tool_calls | both exact | ~10s, plus 65s cold load |
| qwen2.5-coder:14b | 9.0GB | JSON in content, no tool_calls | both exact | — |
| gemma4:12b | 7.6GB | tool_calls | **`deltaSec: +0.5`** — lengthens the clip | — |

Three findings drive the design:

1. **`lfm2.5` is the default.** At 5.2GB it leaves 15.7GB free, so it coexists with ComfyUI and no
   turn-taking scheme is needed. The 27B holds 17.3GB and leaves 842MB, which starves i2v entirely.
2. **`num_predict` must be generous.** `lfm2.5` first appeared to fail completely; it had spent a
   200-token budget inside `<think>` and never reached the call. At 1200 it answers correctly in 1-2s.
   A stingy budget on a thinking model looks exactly like a model that cannot tool-call.
3. **The dangerous failure is a confident wrong value, not a malformed one.** `gemma4:12b` produced a
   perfectly-formed command to lengthen a clip the user said was too long. Propose-then-approve catches
   that; auto-apply would not have.

A note on ComfyUI's `/api/comfy/status`: while the 27B held the card, it reported 23.1GB free at the
moment `nvidia-smi` reported 842MB. It reports its own allocator's view. Do not use it to decide
whether a model will fit.

## 3. Architecture

```
Studio :3120  (Next.js)
  agent panel: prompt box -> proposal review -> Apply / Discard
   |
   |-- POST /api/reel/[slug]/agent        {prompt}     -> {commands[], reel, rejected[]}
   |-- POST /api/reel/[slug]/preview      {commands[]} -> dry run, persists nothing
   |-- POST /api/reel/[slug]/agent/apply  {commands[]} -> applyCommand each, actor 'agent'
   |
   |-- settings.agentProvider = 'claude' -> lib/ai/agent/claude.ts   (runClaude, existing CLI)
   `-- settings.agentProvider = 'local'  -> lib/ai/agent/local.ts -> iolar-agent :3121
                                                                      |
                                                          LangGraph + FastAPI (Python, Docker)
                                                                      |-- Ollama :11436, lfm2.5
                                                                      `-- back to /preview via
                                                                          host.docker.internal:3120
```

Both providers satisfy one interface, so the panel and the apply path never learn which ran:

```ts
type AgentRequest = { slug: string; reel: Reel; prompt: string };
type AgentProposal = { commands: CommandInput[]; note?: string; raw?: string };
interface AgentBackend { propose(req: AgentRequest): Promise<AgentProposal>; }
```

### 3.1 Why LangGraph rather than one Ollama call

The agent gets `preview` as a **tool**. It proposes commands, sees the simulated reel, and corrects
itself before the proposal ever reaches the studio. Without that loop this design is a single chat
completion and a prompt template, and LangGraph would be dead weight. The loop is the justification.

Graph: `plan -> simulate -> critique -> (revise | done)`, capped at 3 revisions, so a confused model
cannot spin. Every state carries the reel summary, not the whole reel, to keep the context small.

### 3.2 Dry run

New in the command layer, and the only change to it:

```ts
previewCommands(slug, commands: CommandInput[]): Promise<{
  reel: Reel;                        // the reel as it would stand
  applied: { op: string; summary: string }[];
  rejected: { op: string; error: string; detail: unknown }[];
}>
```

Folds the commands over an in-memory reel through the same registry, the same zod schemas, the same id
resolution and the same `validateReel`. It does not save, does not publish, does not touch history.
Rejected commands are reported, never silently dropped — a proposal that half-failed must look
different from one that succeeded.

**Preview continues past a rejection; apply stops at one.** The asymmetry is deliberate. Preview is
diagnostic: an agent with a 3-revision budget should learn everything wrong with its plan in one round
trip, not one mistake per iteration. Apply is not diagnostic, and a later command usually depends on an
earlier one, so it stops rather than applying step 5 of a plan whose step 2 failed.

What keeps the two consistent is that **a proposal with any rejection is never applied**: the studio
offers Apply only when `rejected` is empty, and the agent loop treats any rejection as a revision
trigger. So the projected reel is only ever acted on when it was produced by a clean run, and preview
predicts apply exactly in the only case that reaches apply.

`POST /api/reel/[slug]/preview` exposes it to both the studio and the agent container.

`POST /api/reel/[slug]/agent` runs the chosen backend and then previews whatever it proposed before
answering, so the studio always receives a proposal that has already been checked against the real reel.

### 3.2.1 Preview is advisory, not a promise

A preview describes the reel as it stood when the preview ran. ComfyUI jobs land asynchronously through
`addAsset` and `updateAsset` while you are reading a proposal, so the reel can move underneath it.

Apply therefore re-runs every command through the full `applyCommand` path — schemas, id resolution,
`validateReel` — and may reject what preview accepted. It applies commands in order and stops at the
first rejection rather than skipping past it, because later commands in an agent's plan usually depend
on earlier ones. The response reports what landed and what did not; everything that landed is in
history and individually undoable.

This is not a lock. Locking the reel while a human reads a proposal would stall shot generation, which
is the one thing that must not wait.

### 3.3 Tool schemas are generated

The tool list handed to the model is derived from `COMMANDS` via `z.toJSONSchema`, never hand-written,
and a contract test asserts one tool per command. Hand-copying an enum is precisely how `crossfade`
became `fade` during the command-layer build; the same mistake in a tool schema would surface as the
model "hallucinating" an invalid value.

Tool names replace the dot with an underscore (`clip.trim` -> `clip_trim`) because function-calling
schemas across providers disallow dots; the mapping is mechanical and covered by the same test.

### 3.4 Response normalizer

Accepts either shape: real `tool_calls`, or a JSON array in `content` (what `qwen2.5-coder` produced).
One function, tested against captured fixtures of both. This is what makes `agentModel` a setting
rather than a code change.

## 4. Container

`agent/` in this repo: `Dockerfile`, `pyproject.toml`, `graph.py`, `server.py`, `compose.yml`.

- Port **3121** on the host (3120 is the studio; both free, neither in `_devkit/PORTMAP.md`).
- Talks to Ollama at `http://host.docker.internal:11436` and back to the studio at
  `http://host.docker.internal:3120`.
- No GPU device request: it never runs a model itself, it calls Ollama.
- `GET /health` reports its own status plus whether Ollama answers and whether `agentModel` is present,
  so the studio can tell "container down" from "model not pulled".

The model lives in the existing `invisible-ollama` container. Pulling a second 5.2GB copy into a
dedicated container buys isolation not worth the disk here; the cost is that stopping that project's
stack stops iolar's agent, which `/health` will say plainly.

**This is the first Python in a TypeScript repo.** Accepted because LangGraph is Python. It is confined
to `agent/`, communicates only over HTTP, and the studio treats it as an external service that may be
absent.

## 5. Settings

Added beside `voiceProvider` and `heroProvider`:

| Key | Default | Purpose |
|---|---|---|
| `agentProvider` | `'local'` | `'local'` or `'claude'`. Defaults to local as requested; until phase 3 lands, the panel reports the container as unreachable rather than failing silently |
| `agentUrl` | `http://127.0.0.1:3121` | the LangGraph service |
| `agentOllamaUrl` | `http://127.0.0.1:11436` | where the model is served |
| `agentModel` | `lfm2.5` | swappable without code changes |
| `agentNumPredict` | `1200` | a thinking model starved of budget returns nothing |
| `agentMaxRevisions` | `3` | graph loop cap |

## 6. Error handling

Every message names the fix, because the first audience is someone deciding what to restart.

| Condition | Studio shows |
|---|---|
| agent container unreachable | the URL tried, and that `agent/compose.yml` starts it |
| Ollama unreachable | the URL tried, and which container serves it |
| model not present | the model name and the `ollama pull` line |
| model returned nothing parseable | the raw text, and no proposal |
| model proposed invalid commands | the valid ones as applicable, the rest listed as rejected with reasons |
| any command rejected | the rejections, and no Apply button — a partially valid proposal is never half-applied |
| apply fails partway | which commands landed and which did not; everything that landed is in history and individually undoable |
| the reel moved between preview and apply | the rejection from the re-validation, with the proposal still on screen to re-run |

A failed proposal changes nothing: preview persists nothing, so there is no state to roll back.

## 7. Testing

| File | Covers |
|---|---|
| `tests/reel.preview.test.ts` | dry run leaves reel, history and bus untouched; rejected commands reported not dropped; a mid-list rejection does not abort the rest, and the projected reel reflects only the commands that applied |
| `tests/agent.tools.test.ts` | one tool schema per command; dot-to-underscore mapping; schemas match the zod shapes |
| `tests/agent.normalize.test.ts` | `tool_calls` and JSON-in-content fixtures both parse; garbage yields no proposal, not a crash |
| `tests/agent.backend.test.ts` | provider switch honours settings; unreachable, timeout and garbage each produce the §6 message |
| `tests/api.reel.agent.test.ts` | endpoint contract for `/agent`, `/preview`, `/agent/apply`; apply re-validates and stops at the first rejection, reporting what landed |
| `agent/tests/test_graph.py` | graph revises on a rejected preview and stops at the cap; mocked Ollama |
| `tests/reel.parity.test.ts` | unchanged, must still pass |

Model quality itself is not unit-tested — it is not deterministic. The probe from §2 becomes
`agent/tests/probe.py`, run by hand when changing `agentModel`.

## 8. Phases

1. **Dry run** — `previewCommands` plus `POST /preview`. Pure TypeScript, useful on its own.
2. **Agent seam** — tool-schema generation, normalizer, `AgentBackend`, settings, `/agent` and
   `/agent/apply`, with a stub backend returning a fixed command list. The whole studio flow becomes
   testable before any Python exists.
3. **Local backend** — `agent/` container, LangGraph, wired to lfm2.5.
4. **Agent panel** — prompt box, proposal diff, Apply/Discard.
5. **Claude backend** — the second provider, once the interface has proven itself against a real one.

Phase 2's stub is what keeps phases 3 and 4 independent.

## 9. Non-goals

Auto-applying edits; the agent generating assets or calling ComfyUI; multi-turn chat with memory across
runs; agents editing more than one reel; training or fine-tuning; running the model outside Ollama;
replacing `runClaude` for the planning stage, which stays as it is.
