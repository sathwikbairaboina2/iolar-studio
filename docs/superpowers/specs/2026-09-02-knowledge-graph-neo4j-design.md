# Knowledge graph on Neo4j, agent memory on Qdrant

**Date:** 2 September 2026
**Status:** draft for review
**Replaces:** the `nodes` / `edges` tables in `data/iolar.db` and `lib/graph.ts`

## Why

The studio has one knowledge graph, hand-rolled in SQLite, fed only by handbooks, and
the page that draws it still filters for a node type that no longer exists. Reels write
nothing to it on purpose. Jobs never touched it. Meanwhile the qwen research agents
start every hunt from zero: the planner does not know which domains were good last time,
the critic re-judges the same Cloudflare walls, the writer re-proves claims a previous
reel already verified against a passage.

Two stores fix both problems. Neo4j holds the graph, one space per category, with
cross-links where the same topic or source appears in more than one. Qdrant holds the
text the agents need to find by meaning: source passages, verified claims, past scripts.
Files on disk stay the truth; both stores are derived and rebuildable.

## Goals

1. Three graphs on one page, one tab each: Handbooks, Reels, Jobs. A fourth tab, All,
   shows only the nodes that connect two spaces.
2. Research agents remember. Phase 1: sources and claims. Phase 2: scripts and style.
   Phase 3: cross-category links the writer can cite.
3. Nothing leaves the machine. Neo4j and Qdrant run in docker; embeddings come from
   `nomic-embed-text` on research-ollama.
4. Data lives on `D:`. Both volumes bind-mount there.
5. Everything is rebuildable from `data/` with one command.

## Non-goals

- A graph editor. The page reads; the pipeline writes.
- Replacing the SQLite bookkeeping tables (`subjects`, `chapters`, `books`, `refs`,
  `renders`). They stay for the handbook fit loop. Only the graph moves.
- Feeding Claude-backed stages. Memory is for the local agents. The Claude path keeps
  working as before and simply gets no context injected.
- Writing to the jobs-reel plugin. The studio reads its board and indexes what it reads.

## Stores and deployment

`docker/compose.yml` in the studio, beside `agent/compose.yml`:

| Service | Image | Host port | Volume |
|---|---|---|---|
| `iolar-neo4j` | `neo4j:5.26-community` | 3124 bolt, 3125 http | `D:\iolar\neo4j\data`, `D:\iolar\neo4j\logs` |
| `iolar-qdrant` | `qdrant/qdrant:v1.13` | 3126 http, 3127 grpc | `D:\iolar\qdrant\storage` |

Both bound to `127.0.0.1`. Neo4j auth `neo4j` / a password from `data/settings.json`
(`neo4jPassword`, default `iolar-local`), never from the browser. Compose gets the
values from `.env` beside it, written once by `scripts/knowledge-env.mts` from settings
so the two cannot drift.

Ports sit in the studio's `312x` block: 3120 studio, 3121 edit agent, 3124 to 3127
knowledge. `_devkit/PORTMAP.md` gains the four rows.

Plugins page cards `neo4j` and `qdrant`, same shape as the others: health from
`http://127.0.0.1:3125/` and `http://127.0.0.1:3126/healthz`, Start runs
`docker compose -f docker/compose.yml up -d <service>` from the studio root, open link
to the Neo4j browser and the Qdrant dashboard. A card check shows node count and point
count so an empty store is visible before an agent notices.

## Settings

New keys in `lib/settings.ts`, all with local defaults:

```
neo4jUrl:        'bolt://127.0.0.1:3124'
neo4jUser:       'neo4j'
neo4jPassword:   'iolar-local'
qdrantUrl:       'http://127.0.0.1:3126'
embedOllamaUrl:  'http://127.0.0.1:25103'     // research-ollama, already holds the model
embedModel:      'nomic-embed-text'
knowledgeMemory: true                         // agents read memory; off = today's behaviour
```

## Graph model

One database. Every node carries `space` (`handbooks` | `reels` | `jobs`) except the
shared ones, which carry `space: 'shared'`. Labels are singular nouns.

### Shared

| Label | Key | From |
|---|---|---|
| `Topic` | `key` (normalised phrase, same `topicKey()` as today) | every space |
| `Source` | `url` (canonical) | reels, handbooks references |
| `Domain` | `host` | derived from Source |
| `Claim` | `id` (hash of normalised text) | reels, phase 3 handbooks |

### Handbooks

```
(Subject {slug, name, emoji})
  -[:HAS_CHAPTER]-> (Chapter {subject, slug, title, status, parts})
  -[:COVERS]->      (Topic)
(Chapter) -[:CITES]-> (Source)
(Chapter) -[:SHARES_TOPIC {count}]- (Chapter)      // derived, rebuilt on write
```

### Reels

```
(Reel {slug, title, pattern, status, updatedAt})
  -[:ABOUT]->        (Topic)                        // from brief.topic and mustProve
  -[:MUST_PROVE]->   (Claim {text, key})
  -[:HUNTED]->       (Source {url, title, publisher, publishedAt, assetKind})
       with {verdict, score, reason, hunterAgent, at}
  -[:KEPT]->         (Source)                       // reviewed as keep
  -[:REJECTED]->     (Source)  with {reason}
(Source) -[:ON]-> (Domain {host, kept, rejected, walled})   // counters, rebuilt
(ScriptLine {reelSlug, id, role, text, status})
  -[:CITES]->   (Source)
  -[:PROVES]->  (Claim)                             // from coverage judge
  -[:FLAGGED {issue}]-> (Source)                    // verifier objection
(Claim) -[:SUPPORTED_BY {passage, figure, at}]-> (Source)   // verified line, no flag
```

`SUPPORTED_BY` is the memory that matters: a claim, the exact passage that held it,
on which source. It is written only when the verifier passed the line.

### Jobs

```
(Week {week, stage, counted, rejected, style, world})
  -[:LISTS {count}]-> (Employer {name})
  -[:IN]->            (Function {name})              // the plugin's enum
  -[:IN]->            (City {name})
  -[:MODE {count}]->  (WorkMode {name})
  -[:HIGHLIGHT {score, scene}]-> (Topic)            // the planner's ranked highlights
```

An employer's history is the set of weeks with a `LISTS` edge to it; no reverse edge is
stored.

Weeks are read from the board (`GET /api/weeks/{week}`), never from the plugin's disk.

### Cross-links (the All tab)

Nodes with edges from two spaces: a `Topic` covered by a chapter and a reel, a
`Source` cited by a chapter and hunted by a reel, an `Employer` that is also a reel's
subject. No new edges are invented; the tab is one query: nodes whose neighbours carry
more than one distinct `space`, with those neighbours.

## Vector collections

Qdrant, one collection per kind, all with `space` and ids in the payload so a query can
be scoped or crossed:

| Collection | Vector of | Payload |
|---|---|---|
| `passages` | 400-token chunks of gathered evidence | `space, reelSlug, sourceUrl, host, candidateId, kind, chunk, retrievedAt` |
| `claims` | claim text | `space, key, reelSlug, supportedBy[], verifiedAt` |
| `scripts` | one script line | `space, reelSlug, lineId, role, status, approved` (phase 2) |
| `chapters` | one chapter summary + headings | `space, subject, chapter` (phase 3) |

Embeddings: `nomic-embed-text`, 768 dims, cosine. Prefix `search_document:` on write
and `search_query:` on read, as that model expects.

## Write path

One module, `lib/knowledge/`:

```
lib/knowledge/
  index.ts        // the public surface: record*, recall*, reindex
  neo4j.ts        // driver, session helper, Cypher in one place
  qdrant.ts       // client, ensureCollections, upsert, search
  embed.ts        // ollama embeddings, batched, cached by text hash
  spaces/
    handbooks.ts  // Subject/Chapter/Topic writers, replaces lib/graph.ts
    reels.ts      // brief, hunt, review, script, verify writers
    jobs.ts       // week writer, reads the board
  recall.ts       // what the agents ask: domains for a subject, claims near a text, ...
  fake.ts         // in-memory driver + vector store for tests
```

Writes are **write-through and idempotent**: every writer is a `MERGE`, every vector
upsert uses a deterministic point id (hash of `space + kind + key`). Running a writer
twice changes nothing. That is what makes `reindex` safe.

Callers, all already existing, each gets one call added:

| Event | Where | Writer |
|---|---|---|
| chapter saved | `lib/store.ts` save mirror | `handbooks.syncChapter` |
| book saved | same | `handbooks.syncBook` |
| brief written | `research/store.writeBrief` | `reels.recordBrief` |
| candidates written | `research/store.writeCandidates` | `reels.recordHunt` |
| selection written | `research/store.writeSelection` | `reels.recordReview` |
| evidence gathered | `gatherRun.gatherEvidence` | `reels.recordEvidence` (passages) |
| script written or verified | `research/store.writeScript` | `reels.recordScript` (lines, flags, proves, SUPPORTED_BY) |
| Jobs tab loads, or reindex | `app/api/jobs/weeks` | `jobs.recordWeek` for weeks not yet indexed at that stage |

A writer never fails its caller. It catches, logs one line through `logPlugin`, and
returns. A store that is down costs memory, not a reel.

## Reindex

`scripts/reindex-knowledge.mts [--space handbooks|reels|jobs] [--wipe]` walks
`data/handbooks/`, `data/reel/*/research/`, and the jobs board, and calls the same
writers. `--wipe` clears the space first. This replaces `scripts/reindex.mts` for the
graph part; that script keeps rebuilding the SQLite tables.

## Agent memory, phase 1

All retrieval goes through `recall.ts`, which returns plain text blocks the prompts
splice in. Every block is capped so a prompt never grows past what qwen handles.

### Planner (`planSearch`)

Gets `recall.domainsFor(topics)`: up to 12 domains ranked by kept minus rejected on
sources ABOUT any of the brief's topics, with counts, and up to 6 domains flagged
`walled` (unreadable in the past). Prompt addition:

```
What worked before for topics like these:
  ccaf.io          kept 3, rejected 0
  sqlite.org       kept 5, rejected 2
Avoid, they did not read last time:
  iea.org          bot wall
```

### Critic (`critique`)

Gets `recall.priorVerdicts(urls)`: for each hunted URL already in the graph, the last
verdict, reason and reel. The critic keeps its own judgement but is told "this exact
page was rejected as a duplicate of X on 2026-09-01".

### Writer (`draftScript`)

Gets `recall.provenClaims(mustProve, topics)`: Qdrant search on `claims` near each
mustProve claim, filtered to claims with at least one `SUPPORTED_BY`, returning the
claim, passage and source URL. Capped at 8. The writer may cite a prior source only if it
is also in this reel's kept set; otherwise the block is shown as "already proven
elsewhere, hunt this source if you want it" and the planner's next run sees it as a
suggested query. This keeps the rule that a script cites what survived this reel's
review.

### Verifier (`verifyScript`)

Gets `recall.passagesFor(lineText, keptCandidateIds)`: Qdrant search on `passages`
scoped to this reel's kept sources, top 3 chunks, spliced ahead of the keyword windows
`evidenceFor()` builds today. Fixes the observed gap where the right passage sat past
the 20,000-character cap: passages are chunked from the full gathered text, so the cap
on `pageText` rises to 200,000 and only the prompt window stays small.

### What phase 1 does not do

No memory for the coverage judge, no script memory, no cross-space cites. The Claude
provider path is untouched.

## Phases 2 and 3

- **Phase 2, script and style:** `scripts` collection, `ScriptLine.approved`, `Reel.hook`.
  Planner gets "angles already used on this topic" and "hooks that were approved". Judge
  gets nothing new.
- **Phase 3, cross-category:** `chapters` collection; writer's `provenClaims` also
  returns handbook chapters near a claim and jobs weeks that HIGHLIGHT the topic; a
  script line may `CITES` a Chapter, rendered as a "see the handbook" card in the studio.

## Page

`app/graph/page.tsx` becomes a tabbed page: Handbooks, Reels, Jobs, All. Each tab asks
`GET /api/graph?space=<space>` which runs one Cypher per space, capped at 400 nodes,
most-connected first, and returns `{nodes, edges}` in the shape the renderer takes.
Renderer: `cytoscape` with `cytoscape-fcose` layout, both npm, both already used by the
Neo4j browser's ecosystem so the shape is familiar. Colour by label. Click a node for its
neighbours and, for a Source, the verdict history; for a Claim, its passage.

Search box stays: `GET /api/graph?space=<space>&q=` runs a label `CONTAINS` match, and
a second, lower box, "ask by meaning", runs the Qdrant search on that space's
collections and shows the top hits with scores. That box is how you see what the agents
would see.

If Neo4j is down the page says so with a link to Plugins, like the Jobs tab does.

## Migration

1. Land the stores, the module, the reindex, the page. `lib/graph.ts` is deleted; its
   three readers (`chapterContext`, `coveredElsewhere`, `searchTopics`) move to
   `lib/knowledge/spaces/handbooks.ts` with the same signatures, on Cypher.
2. `lib/db.ts` drops the `nodes` and `edges` tables and the two indexes at open, the way
   it already drops legacy schema. Nothing else in SQLite changes.
3. `scripts/reindex-knowledge.mts --wipe` builds everything from disk. Run once after
   the compose is up. Existing 22 reels with research folders and the two handbook
   chapters populate the graph.

## Testing

- Unit: every writer and every recall against `fake.ts`, an in-memory graph and vector
  store with the same surface as `neo4j.ts` and `qdrant.ts`. Idempotence is a test:
  write twice, count once.
- Cypher is tested for shape, not by parsing: each writer's statements are captured by
  the fake and asserted to `MERGE`, never `CREATE`.
- Integration, opt-in with `KNOWLEDGE_LIVE=1`: brings up compose, writes one reel's
  research folder, reads it back, tears down the space.
- Prompt tests: the existing `research.agents.test.ts` gains cases where recall
  returns blocks and asserts they land in the prompt and stay under the cap.
- Page: `graph.test.ts` reworked for the tabbed API; a cytoscape smoke render in jsdom.

## Risks

- **Neo4j memory.** Default heap is fine for this size, but the container should set
  `NEO4J_server_memory_heap_max__size=1G` so it never fights the GPU processes for RAM.
- **Embedding throughput.** A full reindex embeds every passage chunk; at ~200 chunks
  per reel and 22 reels that is ~4,400 calls to a 137M-parameter model on the research
  ollama. Batched, cached by text hash, it is minutes, not hours. Reindex runs while
  qwen is idle; `yieldGpuToComfy` is not involved, the embed model is small.
- **The board as a source.** Jobs indexing depends on :26100 being up. When it is not,
  the Jobs tab of the graph shows what was indexed last and says the board is down.
- **Prompt growth.** Every recall block is capped in characters and count. The tests
  hold the caps.
