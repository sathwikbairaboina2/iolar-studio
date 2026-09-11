# Explainer renders as jobs

**Date:** 2026-09-11
**Status:** design, ready to plan
**Follows:** `2026-09-11-explainer-commands-design.md` (the write path), which named this as the
first of three subsystems left out of it.

## The problem

`POST /api/explainers/<slug>/render` submits to the templates service and then **holds the request
open**, polling every 1.2s for up to fifteen minutes, before answering. Three things follow from
that, and all three are visible in the studio today:

1. A closed tab loses the render. Nothing on disk says a job was ever submitted, so the page has
   no way to pick it back up.
2. There is no progress. The service reports `0..1` on every poll; the studio throws it away
   because it is inside a loop nobody can see.
3. There is one mp4. `renders/reel.mp4` is overwritten by the next render, so the previous cut is
   gone and there is no way to compare two takes of the same board.

Every other category in the studio already submits and polls: a pattern reel keeps
`reel.pattern.job` on the document and answers each poll from the service's word on it
(`lib/reel/pattern/run.ts`). Explainers are the odd one out.

## What this builds

A render log per explainer, the routes to drive it, and a panel that shows it.

### The record

`data/explainer/<slug>/renders/index.json`:

```json
{ "version": 1, "renders": [ { "id": "…", "…": "…" } ] }
```

Newest first. One entry per submitted job:

| field | meaning |
|---|---|
| `id` | the service's job id; also the file name of its mp4 |
| `submittedAt` / `finishedAt` | ISO, `finishedAt` null until done or failed |
| `state` | `queued` \| `preparing` \| `rendering` \| `done` \| `failed` — the service's own words |
| `progress` | `0..1` while live, null otherwise |
| `error` | the service's message on failure, else null |
| `seconds` / `frames` | from the timeline, once it is home |
| `docHash` | the document this render was made from |
| `title` / `theme` | what it was called and how it looked when submitted |

The mp4 lands at `renders/<id>.mp4` and its timeline at `renders/<id>.timeline.json`. **The job id
is the file name**, so a record and its file cannot come apart the way a single `reel.mp4` and a
job id in a different file can.

`docHash` is a sha1 over `JSON.stringify(doc)` as the store writes it — the document is already
written by a schema parse, so its key order is stable and the hash is stable with it. A render
whose `docHash` is not the current document's is shown as **from an older document**; that is the
same staleness a pattern reel reports, and it answers the question people actually ask, which is
"is what I am watching what I am looking at?"

### The module — `lib/explainer/renders.ts`

```ts
export type RenderState = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed';
export type RenderRecord = { id, submittedAt, finishedAt, state, progress, error, seconds, frames, docHash, title, theme };
export type RenderLog = { renders: RenderRecord[]; live: boolean; currentHash: string };

export function hashDoc(doc: ExplainerDoc): string;
export async function read(slug: string, doc?: ExplainerDoc | null): Promise<RenderLog>;
export async function start(slug: string, doc: ExplainerDoc, opts?: ServiceOpts): Promise<RenderRecord>;
export async function poll(slug: string, opts?: ServiceOpts): Promise<RenderLog>;
export async function latestDone(slug: string): Promise<RenderRecord | null>;
```

`start` validates before it submits, so a bad document is still reported as a document problem and
never becomes a failed job. `poll` asks the service about every record that is not yet finished,
mirrors what it says, and — on `done` — downloads the mp4 and the timeline **before** writing the
record as done. A record is `done` on disk only when its mp4 is on disk beside it.

`ServiceOpts` (`baseUrl`, `fetchImpl`) is threaded through both, the way `lib/reel/pattern/run.ts`
threads it, because that is how this codebase tests a service without mocking a module.

**Pruning:** twenty records. Past that the oldest is dropped and its mp4 and timeline go with it.
Twenty is roughly a day of iterating on one explainer, and at ~2 MB a cut it is ~40 MB per
explainer, which is the same order as what a reel keeps.

### The routes

| route | does |
|---|---|
| `POST /api/explainers/<slug>/render` | submit; **202** with the new record. 503 if the service is down, 422 if it rejects the document — unchanged from today. |
| `GET /api/explainers/<slug>/render` | poll the service for anything live, then answer with the whole log |
| `DELETE /api/explainers/<slug>/render` | `{id}` — stop that render. `DELETE /jobs/{id}` on the service drops the job, and the record is written failed with `stopped here`, because that is what stopped looks like to everything reading this list. |
| `GET /api/explainers/<slug>/renders/<id>/mp4` | stream one render |
| `GET /api/explainers/<slug>/mp4` | stream the newest **done** render — same path as today, resolved from the log rather than from a fixed file name, falling back to an older explainer's `reel.mp4` when there is no log yet |

`POST` no longer waits. That is the whole point, and it is why the response is 202 rather than 200:
the answer is "this is now a job", not "here is your video".

### On screen

`useExplainerRenders(slug)` sits beside `useExplainerEditor`. It polls `GET …/render` every 1500ms
**only while something is live**, and stops the moment nothing is. A hook that polls a finished job
forever is the kind of thing that quietly eats a laptop; this one has an off switch and uses it.

A **Renders** card under the document panel lists the log: state tag, how long ago, duration,
and a badge when the record's `docHash` is not the current one. Clicking a done record plays it in
the video panel. The Render button submits and returns at once; while a job is live it shows the
service's progress.

## What this deliberately does not do

- **No queue of its own.** The templates service already queues; a second queue in the studio would
  only be able to disagree with it.
- **No cross-explainer job list.** The Jobs tab is about job cards, not renders. If a global render
  list is wanted later it reads these logs; it does not need them to be stored anywhere else.

## Testing

`tests/explainer.renders.test.ts`, with a fake `fetchImpl` in the shape
`tests/reel.pattern.run.test.ts` already uses:

- a submitted render is written as `queued` with the document's hash
- a poll mirrors `rendering` and keeps the record live
- a poll that sees `done` downloads the mp4 first and only then writes the record done
- a failed job keeps its error message and is not live
- the twenty-first render drops the oldest, and its mp4 goes with it
- `latestDone` ignores a newer failed render
- a document edited after a render makes that record read as stale
- stopping a live render drops the job at the service and records why it ended
- stopping a finished render asks the service nothing
