# Knowledge Layer, Part 2: Agent Memory (phase 1) and the How-It-Works Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four local research agents read the knowledge stores before they act, through capped text blocks spliced into their existing prompts, and the studio gains a "How it works" tab that explains what is implemented.

**Architecture:** One module `lib/knowledge/recall.ts` turns Cypher and vector queries into plain-text blocks with hard caps. Each agent function in `lib/reel/research/agents.ts` gains an optional trailing `memory` string. The graph nodes in `lib/reel/research/graph.ts` call recall when `knowledgeMemory` is on and pass the block through; the Claude path and `knowledgeMemory: false` get an empty block and behave exactly as today. The How-it-works tab reads a manifest file that every task in both plans updates.

**Tech Stack:** as Part 1. Depends on Part 1 being merged (stores, fakes, spaces, `useStoresForTests`, `safely`, `pointId`, `claimId`, `hostOf`, `chunkText`).

**Spec:** `docs/superpowers/specs/2026-09-02-knowledge-graph-neo4j-design.md`, section "Agent memory, phase 1" and "Page".

**Part 1:** `docs/superpowers/plans/2026-09-02-knowledge-layer-stores.md`

## Global Constraints

- Every recall block is capped: `MAX_BLOCK_CHARS = 1800` per block, and per-item caps below. The tests hold the caps.
- Recall never throws into an agent: it returns `{ block: '', count: 0 }` on any store error and logs one line via `safely`.
- The Claude provider path (`researchProvider: 'claude'`) receives no memory. `knowledgeMemory: false` receives no memory.
- A prior source is citable by the writer only if it is in this reel's kept set; otherwise it is shown as "already proven elsewhere, hunt this source if you want it".
- No new dependencies.
- All Part 1 constraints (local only, MERGE only, files are truth, test/lint/typecheck commands, commit style) apply.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/knowledge/recall.ts` | `recallDomains`, `recallVerdicts`, `recallClaims`, `recallPassages`, `storeCounts`; formatting and caps |
| `lib/reel/research/agents.ts` | Optional `memory` on `planSearch`, `critique`, `draftScript`, `verifyScript` |
| `lib/reel/research/graph.ts` | Nodes call recall and pass memory; trace notes what memory was used |
| `lib/plugins/health.ts` | Neo4j and Qdrant cards show node and point counts |
| `docs/implementation.json` | The manifest the How-it-works tab renders: one entry per feature, status, files, tests |
| `app/api/about/route.ts` | Serves the manifest and the handbook HTML |
| `app/about/page.tsx` | The tab: feature cards, then the handbook |
| `components/AppShell.tsx` | "How it works" under Library |
| Tests | `tests/knowledge.recall.test.ts`, `tests/research.agents.memory.test.ts`, `tests/research.graph.memory.test.ts`, `tests/about.test.tsx`, `tests/plugins.health.test.ts` extended |

---

### Task 1: Recall

**Files:**
- Create: `lib/knowledge/recall.ts`
- Test: `tests/knowledge.recall.test.ts`

**Interfaces:**
- Consumes: `getStores()`, `safely`, `topicKey`, `claimId`, `hostOf` from Part 1; `Brief`, `ScriptLine`, `Candidate` types.
- Produces:

```ts
export type Recall = { block: string; count: number };
export const MAX_BLOCK_CHARS = 1800;
recallDomains(brief: Brief): Promise<Recall>                 // ≤12 good, ≤6 walled
recallVerdicts(urls: string[]): Promise<Recall>              // ≤20 urls
recallClaims(brief: Brief, keptUrls: string[]): Promise<Recall>   // ≤8 claims
recallPassages(line: ScriptLine, keptCandidateIds: string[]): Promise<Recall>  // ≤3 chunks
storeCounts(): Promise<{ nodes: number; passages: number; claims: number }>
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/knowledge.recall.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGraph, FakeVectors, FakeEmbed } from '@/lib/knowledge/fake';
import { useStoresForTests } from '@/lib/knowledge/stores';
import { parseBrief } from '@/lib/reel/research/brief';

const brief = () => parseBrief({
  runId: 'r', createdAt: '2026-09-02T00:00:00.000Z', topic: 'SQLite runs everything', angle: 'a', audience: 'b', videoFormat: 'reel',
  mustProve: ['SQLite ships in every major phone OS and browser', 'its test suite is orders of magnitude larger than the library'],
  mustInclude: [], avoid: [], recencyWindowDays: 365, sourceClasses: ['docs'], searchQueries: [{ class: 'docs', queries: ['q'] }],
  referenceReel: null, status: 'briefed',
});

let graph: FakeGraph; let vectors: FakeVectors; const embed = new FakeEmbed();
beforeEach(() => {
  graph = new FakeGraph(); vectors = new FakeVectors();
  useStoresForTests({ graph, vectors, embed });
});

describe('recallDomains', () => {
  it('ranks domains by kept minus rejected and lists walled ones separately', async () => {
    graph.answer(/Domain/, [
      { host: 'sqlite.org', kept: 5, rejected: 2, walled: 0 },
      { host: 'ccaf.io', kept: 3, rejected: 0, walled: 0 },
      { host: 'iea.org', kept: 0, rejected: 1, walled: 2 },
    ]);
    const { recallDomains } = await import('@/lib/knowledge/recall');
    const r = await recallDomains(brief());
    expect(r.count).toBe(3);
    expect(r.block).toContain('What worked before for topics like these:');
    expect(r.block.indexOf('sqlite.org')).toBeLessThan(r.block.indexOf('ccaf.io'));
    expect(r.block).toMatch(/Avoid, they did not read last time:[\s\S]*iea\.org/);
    expect(graph.queries[0].params).toMatchObject({ topics: expect.arrayContaining(['sqlite runs everything']) });
  });

  it('is empty when nothing is known, and empty when the store is down', async () => {
    const { recallDomains } = await import('@/lib/knowledge/recall');
    expect(await recallDomains(brief())).toEqual({ block: '', count: 0 });
    graph.query = async () => { throw new Error('ECONNREFUSED'); };
    expect(await recallDomains(brief())).toEqual({ block: '', count: 0 });
  });

  it('never exceeds the block cap however many domains there are', async () => {
    graph.answer(/Domain/, Array.from({ length: 200 }, (_, i) => ({ host: `host-${i}.example.com`, kept: 200 - i, rejected: 0, walled: 0 })));
    const { recallDomains, MAX_BLOCK_CHARS } = await import('@/lib/knowledge/recall');
    const r = await recallDomains(brief());
    expect(r.block.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS);
    expect(r.count).toBeLessThanOrEqual(18);
  });
});

describe('recallVerdicts', () => {
  it('tells the critic what happened to a url last time', async () => {
    graph.answer(/HUNTED/, [{ url: 'https://sqlite.org/hirely.html', verdict: 'reject', reason: 'sales page', reelSlug: 'sqlite-runs-everything', at: '2026-09-01' }]);
    const { recallVerdicts } = await import('@/lib/knowledge/recall');
    const r = await recallVerdicts(['https://sqlite.org/hirely.html', 'https://new.example']);
    expect(r.count).toBe(1);
    expect(r.block).toContain('https://sqlite.org/hirely.html: rejected on 2026-09-01 in sqlite-runs-everything (sales page)');
  });
});

describe('recallClaims', () => {
  it('finds proven claims near each mustProve and marks whether their source is in this reel', async () => {
    await vectors.ensure('claims', embed.dims);
    await vectors.upsert('claims', [{
      id: 'c1', vector: await embed.query('SQLite ships in every major phone OS and browser'),
      payload: { space: 'shared', key: 'k', text: 'SQLite ships in every phone OS', reelSlug: 'old', supportedBy: ['https://sqlite.org/mostdeployed.html'] },
    }]);
    graph.answer(/SUPPORTED_BY/, [{ claim: 'SQLite ships in every phone OS', url: 'https://sqlite.org/mostdeployed.html', passage: 'SQLite is built into every Android and iOS device.', figure: '' }]);
    const { recallClaims } = await import('@/lib/knowledge/recall');
    const inSet = await recallClaims(brief(), ['https://sqlite.org/mostdeployed.html']);
    expect(inSet.block).toContain('citable: https://sqlite.org/mostdeployed.html');
    expect(inSet.block).toContain('built into every Android');
    const outOfSet = await recallClaims(brief(), []);
    expect(outOfSet.block).toContain('already proven elsewhere, hunt this source if you want it');
  });
});

describe('recallPassages', () => {
  it('returns the nearest chunks scoped to the kept candidates', async () => {
    await vectors.ensure('passages', embed.dims);
    await vectors.upsert('passages', [
      { id: 'a', vector: await embed.query('test suite 590 times'), payload: { space: 'reels', candidateId: 'kept1', text: 'The test suite is 590 times larger than the library.', sourceUrl: 'https://sqlite.org/testing.html' } },
      { id: 'b', vector: await embed.query('test suite 590 times'), payload: { space: 'reels', candidateId: 'other', text: 'Not this reel.', sourceUrl: 'https://x' } },
    ]);
    const { recallPassages } = await import('@/lib/knowledge/recall');
    const r = await recallPassages({ id: 'l2', order: 1, role: 'body', text: 'The test suite is 590 times larger.', citations: ['kept1'], assetIds: [], note: null, commentary: false }, ['kept1']);
    expect(r.count).toBe(1);
    expect(r.block).toContain('590 times larger than the library');
    expect(r.block).not.toContain('Not this reel');
  });
});

describe('storeCounts', () => {
  it('reads one count from the graph and two from qdrant', async () => {
    graph.answer(/count\(n\)/, [{ n: 42 }]);
    await vectors.ensure('passages', 8); await vectors.ensure('claims', 8);
    const { storeCounts } = await import('@/lib/knowledge/recall');
    expect(await storeCounts()).toEqual({ nodes: 42, passages: 0, claims: 0 });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/knowledge.recall.test.ts`
Expected: FAIL, cannot resolve `@/lib/knowledge/recall`.

- [ ] **Step 3: Write recall.ts**

```ts
// lib/knowledge/recall.ts
import type { Brief } from '@/lib/reel/research/brief';
import type { ScriptLine } from '@/lib/reel/research/script';
import { getStores } from './stores';
import { safely } from './index';
import { topicKey } from './topics';

/**
 * What the research agents are allowed to remember, as text they can read.
 *
 * Every function returns a block and a count, never throws, and never exceeds
 * MAX_BLOCK_CHARS: a prompt that grows with the graph is a prompt that one day stops
 * fitting, and the agent would fail on the reel with the most history behind it.
 */

export type Recall = { block: string; count: number };
export const MAX_BLOCK_CHARS = 1800;
const NONE: Recall = { block: '', count: 0 };

const cap = (lines: string[], head: string[] = []): Recall => {
  const out: string[] = [...head];
  let n = 0;
  for (const l of lines) {
    if ([...out, l].join('\n').length > MAX_BLOCK_CHARS) break;
    out.push(l);
    n++;
  }
  return n ? { block: out.join('\n'), count: n } : NONE;
};

const topicsOf = (brief: Brief) => [brief.topic, ...brief.mustProve].map(topicKey).filter((t) => t.length >= 3);

export async function recallDomains(brief: Brief): Promise<Recall> {
  return (await safely('recall.domains', async () => {
    const { graph } = getStores();
    const rows = await graph.query<{ host: string; kept: number; rejected: number; walled: number }>(
      `MATCH (t:Topic) WHERE t.key IN $topics
       MATCH (t)<-[:ABOUT|MUST_PROVE|COVERS|HIGHLIGHT]-(x)-[:HUNTED|KEPT|REJECTED]->(s:Source)-[:ON]->(d:Domain)
       WITH DISTINCT d
       RETURN d.host AS host, coalesce(d.kept, 0) AS kept, coalesce(d.rejected, 0) AS rejected, coalesce(d.walled, 0) AS walled
       ORDER BY kept - rejected DESC LIMIT 40`,
      { topics: topicsOf(brief) }
    );
    if (!rows.length) return NONE;
    const good = rows.filter((r) => r.walled === 0 && r.kept + r.rejected > 0).slice(0, 12).map((r) => `  ${r.host.padEnd(28)} kept ${r.kept}, rejected ${r.rejected}`);
    const walled = rows.filter((r) => r.walled > 0).slice(0, 6).map((r) => `  ${r.host.padEnd(28)} bot wall or unreadable, ${r.walled} time${r.walled === 1 ? '' : 's'}`);
    const lines = [...(good.length ? ['What worked before for topics like these:', ...good] : []), ...(walled.length ? ['Avoid, they did not read last time:', ...walled] : [])];
    const r = cap(lines);
    return r.count ? { block: r.block, count: good.length + walled.length > r.count ? r.count : good.length + walled.length } : NONE;
  })) ?? NONE;
}

export async function recallVerdicts(urls: string[]): Promise<Recall> {
  return (await safely('recall.verdicts', async () => {
    if (!urls.length) return NONE;
    const { graph } = getStores();
    const rows = await graph.query<{ url: string; verdict: string; reason: string; reelSlug: string; at: string }>(
      `MATCH (r:Reel)-[h:HUNTED]->(s:Source) WHERE s.url IN $urls
       WITH s, h, r ORDER BY h.at DESC
       WITH s, collect({verdict: h.verdict, reason: h.reason, reelSlug: r.slug, at: h.at})[0] AS last
       RETURN s.url AS url, last.verdict AS verdict, last.reason AS reason, last.reelSlug AS reelSlug, last.at AS at LIMIT 20`,
      { urls: urls.slice(0, 60) }
    );
    if (!rows.length) return NONE;
    const word = (v: string) => (v === 'keep' ? 'kept' : v === 'reject' ? 'rejected' : 'marked maybe');
    return cap(rows.map((r) => `  ${r.url}: ${word(r.verdict)} on ${String(r.at).slice(0, 10)} in ${r.reelSlug}${r.reason ? ` (${String(r.reason).slice(0, 80)})` : ''}`), ['Seen before:']);
  })) ?? NONE;
}

export async function recallClaims(brief: Brief, keptUrls: string[]): Promise<Recall> {
  return (await safely('recall.claims', async () => {
    const { graph, vectors, embed } = getStores();
    const kept = new Set(keptUrls);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const claim of brief.mustProve) {
      const hits = await vectors.search('claims', await embed.query(claim), { limit: 3, filter: { space: 'shared' } }).catch(() => []);
      for (const h of hits) {
        const text = String(h.payload.text ?? '');
        if (!text || seen.has(text) || h.score < 0.5) continue;
        seen.add(text);
        const proofs = await graph.query<{ claim: string; url: string; passage: string; figure: string }>(
          `MATCH (c:Claim)-[p:SUPPORTED_BY]->(s:Source) WHERE c.text = $text
           RETURN c.text AS claim, s.url AS url, p.passage AS passage, p.figure AS figure ORDER BY p.at DESC LIMIT 2`,
          { text }
        );
        for (const p of proofs) {
          const tag = kept.has(p.url) ? `citable: ${p.url}` : `already proven elsewhere, hunt this source if you want it: ${p.url}`;
          lines.push(`- "${p.claim}" — ${tag}\n    passage: ${String(p.passage ?? '').slice(0, 240)}`);
        }
        if (lines.length >= 8) break;
      }
      if (lines.length >= 8) break;
    }
    return lines.length ? cap(lines.slice(0, 8), ['Already proven, with the passage that proved it:']) : NONE;
  })) ?? NONE;
}

export async function recallPassages(line: ScriptLine, keptCandidateIds: string[]): Promise<Recall> {
  return (await safely('recall.passages', async () => {
    if (!keptCandidateIds.length) return NONE;
    const { vectors, embed } = getStores();
    const hits = await vectors.search('passages', await embed.query(line.text), { limit: 3, filter: { candidateId: keptCandidateIds } });
    if (!hits.length) return NONE;
    return cap(hits.map((h) => `  [${String(h.payload.sourceUrl ?? '')}] ${String(h.payload.text ?? '').slice(0, 500)}`), ['Nearest passages in the cited sources:']);
  })) ?? NONE;
}

export async function storeCounts(): Promise<{ nodes: number; passages: number; claims: number }> {
  const { graph, vectors } = getStores();
  const [n] = await graph.query<{ n: number }>(`MATCH (n) RETURN count(n) AS n`);
  const passages = await vectors.count('passages').catch(() => 0);
  const claims = await vectors.count('claims').catch(() => 0);
  return { nodes: Number(n?.n ?? 0), passages, claims };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/knowledge.recall.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/recall.ts tests/knowledge.recall.test.ts
git commit -m "feat: the research agents can recall domains, verdicts, proven claims and passages, capped"
```

---

### Task 2: The agents accept memory

**Files:**
- Modify: `lib/reel/research/agents.ts` (`planSearch` line 92, `critique` line 160, `draftScript` line 191, `verifyScript` line 334)
- Test: `tests/research.agents.memory.test.ts`

**Interfaces:**
- Produces, signatures after this task:

```ts
planSearch(brief: Brief, run: Runner = runClaude, memory = ''): Promise<SearchPlan>
critique(brief: Brief, raw: Record<string, unknown>[], run: Runner = runClaude, memory = ''): Promise<{ candidates: Candidate[] }>
draftScript(brief, candidates, evidence, run = runClaude, note?: string, memory = ''): Promise<ScriptLine[]>
verifyScript(lines, candidates, evidence, run = runClaude, memoryFor?: (line: ScriptLine) => string): Promise<Flag[]>
```
Each splices its block under a fixed heading immediately before the prompt's JSON-shape contract, and only when the block is non-empty. `verifyScript` takes a function because its memory is per line.

- [ ] **Step 1: Write the failing test**

```ts
// tests/research.agents.memory.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseBrief } from '@/lib/reel/research/brief';

const brief = () => parseBrief({
  runId: 'r', createdAt: '2026-09-02T00:00:00.000Z', topic: 'SQLite', angle: 'a', audience: 'b', videoFormat: 'reel',
  mustProve: ['one', 'two'], mustInclude: [], avoid: [], recencyWindowDays: 30, sourceClasses: ['docs'],
  searchQueries: [{ class: 'docs', queries: ['q'] }], referenceReel: null, status: 'briefed',
});

const runner = (reply: string) => {
  const prompts: string[] = [];
  const run = vi.fn(async (prompt: string) => { prompts.push(prompt); return reply; });
  return { run, prompts };
};

describe('memory in the prompts', () => {
  it('the planner reads the domain block before the shape contract, and nothing when it is empty', async () => {
    const { planSearch } = await import('@/lib/reel/research/agents');
    const plan = JSON.stringify({ approach: 'x', queries: [{ class: 'docs', query: 'q', proves: 'one', why: 'w' }] });
    const a = runner(plan);
    await planSearch(brief(), a.run, 'What worked before for topics like these:\n  sqlite.org kept 5, rejected 0');
    expect(a.prompts[0]).toContain('MEMORY\nWhat worked before for topics like these:');
    expect(a.prompts[0].indexOf('MEMORY')).toBeLessThan(a.prompts[0].indexOf('Return JSON'));
    const b = runner(plan);
    await planSearch(brief(), b.run, '');
    expect(b.prompts[0]).not.toContain('MEMORY');
  });

  it('the critic reads prior verdicts', async () => {
    const { critique } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ candidates: [] }));
    await critique(brief(), [{ url: 'https://x' }], a.run, 'Seen before:\n  https://x: rejected on 2026-09-01 in r (dup)');
    expect(a.prompts[0]).toContain('MEMORY\nSeen before:');
  });

  it('the writer reads proven claims', async () => {
    const { draftScript } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ lines: [] }));
    await draftScript(brief(), [], {}, a.run, undefined, 'Already proven, with the passage that proved it:\n- "one" — citable: https://x');
    expect(a.prompts[0]).toContain('MEMORY\nAlready proven');
  });

  it('the verifier gets passages per line, ahead of the keyword windows', async () => {
    const { verifyScript } = await import('@/lib/reel/research/agents');
    const a = runner(JSON.stringify({ flags: [] }));
    const lines = [{ id: 'l1', order: 0, role: 'body', text: 'The suite is 590 times larger.', citations: ['c1'], assetIds: [], note: null, commentary: false }] as never;
    const cands = [{ id: 'c1', url: 'https://x', canonicalUrl: 'https://x', title: 't', summary: 's' }] as never;
    const evidence = { c1: { text: 'intro. The suite is 590 times larger than the library. outro.' } };
    await verifyScript(lines, cands, evidence, a.run, (l) => (l.id === 'l1' ? 'Nearest passages in the cited sources:\n  [https://x] The suite is 590 times larger than the library.' : ''));
    const p = a.prompts[0];
    expect(p).toContain('Nearest passages in the cited sources:');
    expect(p.indexOf('Nearest passages')).toBeLessThan(p.indexOf('590 times larger than the library. outro'));
  });
});
```

The exact anchor strings (`Return JSON`, and the verifier's evidence block layout) must match what the prompts contain; read each prompt in `agents.ts` first and adjust the assertion string to the real line that introduces the JSON shape.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/research.agents.memory.test.ts`
Expected: FAIL, the prompts contain no `MEMORY`.

- [ ] **Step 3: Splice the blocks**

At the top of `agents.ts` add:

```ts
/** A recall block, under one fixed heading, or nothing. The heading is what the tests and the trace look for. */
const memoryBlock = (memory: string) => (memory.trim() ? `\nMEMORY\n${memory.trim()}\n` : '');
```

`planSearch(brief, run = runClaude, memory = '')`: insert `${memoryBlock(memory)}` into the template immediately before the line that introduces the JSON shape (the `Return JSON …` paragraph). Same for `critique(brief, raw, run = runClaude, memory = '')` and `draftScript(brief, candidates, evidence, run = runClaude, note?, memory = '')`. Add to each prompt, right after the block, one sentence the model can act on:

- planner: `Prefer domains that worked; do not plan a query against a domain listed under Avoid.`
- critic: `A page rejected before as a duplicate or a wall is probably still one; say so in the reason if you keep it anyway.`
- writer: `Cite a proven claim's source only if it is marked citable; otherwise treat the claim as a lead, not a citation.`

`verifyScript(lines, candidates, evidence, run = runClaude, memoryFor?)`: where the prompt builds each line's evidence excerpt (the `evidenceFor(l.text, text)` call at line 348), prepend `memoryFor?.(l) ?? ''` to that line's block so the nearest passages come before the keyword windows:

```ts
        const recalled = memoryFor?.(l) ?? '';
        const excerpt = text ? evidenceFor(l.text, text) : c?.summary ?? '';
        // …and where `excerpt` is placed into the prompt:
        `${recalled ? recalled + '\n' : ''}${excerpt}`
```

- [ ] **Step 4: Run, expect pass; run the whole research suite**

Run: `npx vitest run tests/research.agents.memory.test.ts tests/research.agents.test.ts tests/research.graph.test.ts`
Expected: PASS. Existing callers pass no memory and see unchanged prompts.

- [ ] **Step 5: Commit**

```bash
git add lib/reel/research/agents.ts tests/research.agents.memory.test.ts
git commit -m "feat: each research agent accepts a memory block and reads it before the shape contract"
```

---

### Task 3: The graph nodes recall

**Files:**
- Modify: `lib/reel/research/graph.ts` (`plan` line 60, `judgePack` line 87, `write` line 123, `verify` line 144, `GraphDeps` line 52)
- Test: `tests/research.graph.memory.test.ts`

**Interfaces:**
- Consumes: Task 1 recall functions; `knowledgeEnabled()`.
- Produces: `GraphDeps.recall?: { domains: typeof recallDomains; verdicts: typeof recallVerdicts; claims: typeof recallClaims; passages: typeof recallPassages }` — defaults to the real module when `knowledgeEnabled()`, to `undefined` otherwise. Trace notes: `memory: N domains`, `memory: N prior verdicts`, `memory: N proven claims`, `memory: passages for N lines`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/research.graph.memory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-mem-'));
});

const brief = {
  runId: 'r', createdAt: '2026-09-02T00:00:00.000Z', topic: 'SQLite', angle: 'a', audience: 'b', videoFormat: 'reel',
  mustProve: ['one', 'two'], mustInclude: [], avoid: [], recencyWindowDays: 30, sourceClasses: ['docs'],
  searchQueries: [{ class: 'docs', queries: ['q'] }], referenceReel: null, status: 'briefed',
};

describe('memory in the graph', () => {
  it('the plan node asks for domains and hands the block to the planner, and says so in the trace', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('r', brief as never);
    const prompts: string[] = [];
    const run = vi.fn(async (p: string) => { prompts.push(p); return JSON.stringify({ approach: 'x', queries: [{ class: 'docs', query: 'q', proves: 'one', why: 'w' }] }); });
    const domains = vi.fn(async () => ({ block: 'What worked before for topics like these:\n  sqlite.org kept 5, rejected 0', count: 1 }));
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    await advanceResearch('r', { run, researchUrl: 'http://x', recall: { domains, verdicts: vi.fn(), claims: vi.fn(), passages: vi.fn() } as never });
    expect(domains).toHaveBeenCalledOnce();
    expect(prompts[0]).toContain('MEMORY\nWhat worked before');
    const { readTrace } = await import('@/lib/reel/research/trace');
    expect((await readTrace('r')).some((e) => /memory: 1 domain/.test(String(e.text)))).toBe(true);
  });

  it('with no recall in deps the planner runs exactly as before', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('r', brief as never);
    const prompts: string[] = [];
    const run = vi.fn(async (p: string) => { prompts.push(p); return JSON.stringify({ approach: 'x', queries: [{ class: 'docs', query: 'q', proves: 'one', why: 'w' }] }); });
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    await advanceResearch('r', { run, researchUrl: 'http://x', recall: undefined });
    expect(prompts[0]).not.toContain('MEMORY');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/research.graph.memory.test.ts`
Expected: FAIL, `domains` not called.

- [ ] **Step 3: Wire recall into the nodes**

In `graph.ts`:

```ts
import { knowledgeEnabled } from '@/lib/knowledge';
import type { recallDomains, recallVerdicts, recallClaims, recallPassages } from '@/lib/knowledge/recall';

export type RecallDeps = {
  domains: typeof recallDomains; verdicts: typeof recallVerdicts; claims: typeof recallClaims; passages: typeof recallPassages;
};

export type GraphDeps = {
  run: Runner;
  researchUrl: string;
  fetchImpl?: typeof fetch;
  huntPollMs?: number;
  /** Memory for the agents. Undefined means none: the Claude path, or knowledgeMemory off. */
  recall?: RecallDeps;
};

const NO_RECALL = { block: '', count: 0 };
```

`plan` node:

```ts
    const mem = deps.recall ? await deps.recall.domains(s.brief) : NO_RECALL;
    if (mem.count) await appendTrace(s.slug, { stage: 'plan', kind: 'note', text: `memory: ${mem.count} domain${mem.count === 1 ? '' : 's'} known for these topics` });
    const plan = await planSearch(s.brief, deps.run, mem.block);
```

`judgePack` node:

```ts
    const urls = raw.map((r) => String(r.canonicalUrl ?? r.url ?? '')).filter(Boolean);
    const mem = deps.recall ? await deps.recall.verdicts(urls) : NO_RECALL;
    if (mem.count) await appendTrace(s.slug, { stage: 'hunt', kind: 'note', text: `memory: ${mem.count} prior verdict${mem.count === 1 ? '' : 's'} on these urls` });
    const judged = await critique(s.brief, raw, deps.run, mem.block);
```

`write` node, after `kept` and `evidence` are known:

```ts
    const mem = deps.recall ? await deps.recall.claims(s.brief, kept.map((c) => c.canonicalUrl || c.url)) : NO_RECALL;
    if (mem.count) await appendTrace(s.slug, { stage: 'write', kind: 'note', text: `memory: ${mem.count} proven claim${mem.count === 1 ? '' : 's'} near the brief` });
    const lines = await draftScript(s.brief, kept, evidence, deps.run, undefined, mem.block);
```

`verify` node (and `revise` where it re-verifies, if it calls `verifyScript` directly): build the per-line memory up front so the prompt builder stays synchronous:

```ts
    const keptIds = s.candidates.map((c) => c.id);
    const perLine = new Map<string, string>();
    if (deps.recall) {
      for (const l of s.lines) {
        if (l.commentary || !l.citations.length) continue;
        const r = await deps.recall.passages(l, keptIds);
        if (r.count) perLine.set(l.id, r.block);
      }
      if (perLine.size) await appendTrace(s.slug, { stage: 'verify', kind: 'note', text: `memory: passages for ${perLine.size} line${perLine.size === 1 ? '' : 's'}` });
    }
    flags = await verifyScript(s.lines, s.candidates, evidence, deps.run, (l) => perLine.get(l.id) ?? '');
```

In `app/api/reel/[slug]/research/run/route.ts` where `advanceResearch` is called on the local path:

```ts
      const recall = getSettings().knowledgeMemory ? await import('@/lib/knowledge/recall') : undefined;
      const out = await advanceResearch(slug, {
        run: qwenRunner(), researchUrl: s.researchUrl,
        recall: recall ? { domains: recall.recallDomains, verdicts: recall.recallVerdicts, claims: recall.recallClaims, passages: recall.recallPassages } : undefined,
      }, body);
```

The Claude path in that route does not call `advanceResearch` and is untouched.

- [ ] **Step 4: Run, expect pass; then a real run**

Run: `npx vitest run tests/research.graph.memory.test.ts tests/research.graph.test.ts tests/api.reel.research.test.ts`
Expected: PASS.

Then, with the stores up and reindexed, run one new brief through the Research tab on a topic that already exists in the graph (SQLite again, a different angle). The trace should show `memory: N domains known for these topics` before the plan, and the plan's queries should lean on `sqlite.org`.

- [ ] **Step 5: Commit**

```bash
git add lib/reel/research/graph.ts "app/api/reel/[slug]/research/run/route.ts" tests/research.graph.memory.test.ts
git commit -m "feat: the research graph recalls before each agent acts, and the trace says what it remembered"
```

---

### Task 4: Counts on the store cards

**Files:**
- Modify: `lib/plugins/health.ts` (the `neo4j` and `qdrant` branches from Part 1 Task 8)
- Test: `tests/plugins.health.test.ts`

**Interfaces:**
- Consumes: `storeCounts()` from Task 1.
- Produces: neo4j card check `N nodes`, qdrant card checks `N passages`, `N claims`; `ready` is `N > 0` for neo4j (an empty graph is a graph nobody reindexed), always `true` for qdrant when it answers.

- [ ] **Step 1: Write the failing test**

Add to `tests/plugins.health.test.ts`:

```ts
  it('shows how much the stores hold, so an empty graph is visible before an agent notices', async () => {
    vi.doMock('@/lib/knowledge/recall', () => ({ storeCounts: async () => ({ nodes: 1234, passages: 5600, claims: 41 }) }));
    mockFetch({
      ':3125': { body: {} }, ':3126': { body: {} },
      ':26100': { body: { ok: true, weeks: 1 } }, ':25100': { body: { ollama: { ok: true }, channels: [] } },
      ':8300': { body: { ok: true, checks: {} } }, ':8080': { body: { ok: true } }, ':8189': { body: {} }, ':11436': { body: {} },
    });
    const { readHealth } = await import('@/lib/plugins/health');
    const all = await readHealth();
    expect(all.find((p) => p.name === 'neo4j')!.checks).toEqual([{ label: '1,234 nodes', ok: true }]);
    expect(all.find((p) => p.name === 'qdrant')!.checks).toEqual([{ label: '5,600 passages', ok: true }, { label: '41 claims', ok: true }]);
  });
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/plugins.health.test.ts`
Expected: FAIL, checks are `answering`.

- [ ] **Step 3: Read the counts**

In `health.ts`, replace the two liveness branches:

```ts
    if (p.name === 'neo4j' || p.name === 'qdrant') {
      let counts = { nodes: 0, passages: 0, claims: 0 };
      try {
        counts = await (await import('@/lib/knowledge/recall')).storeCounts();
      } catch {
        return { ...base, up: true, ready: false, checks: [{ label: 'answering, counts unavailable', ok: false }] };
      }
      const fmt = (n: number) => n.toLocaleString('en-GB');
      if (p.name === 'neo4j') {
        return { ...base, up: true, ready: counts.nodes > 0, checks: [{ label: `${fmt(counts.nodes)} nodes`, ok: counts.nodes > 0, detail: counts.nodes ? undefined : 'run npm run reindex:knowledge -- --wipe' }] };
      }
      return { ...base, up: true, ready: true, checks: [{ label: `${fmt(counts.passages)} passages`, ok: true }, { label: `${fmt(counts.claims)} claims`, ok: true }] };
    }
```

The qdrant branch must still avoid `ask()` (its `/healthz` is text), so keep the text fetch for liveness before this block, as Part 1 Task 8 did.

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/plugins.health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/health.ts tests/plugins.health.test.ts
git commit -m "feat: the neo4j and qdrant cards say how much they hold"
```

---

### Task 5: The How-it-works tab

**Files:**
- Create: `docs/implementation.json`, `app/api/about/route.ts`, `app/about/page.tsx`
- Modify: `components/AppShell.tsx` (Library group, after Plugins), `tests/shell.test.tsx`
- Test: `tests/about.test.tsx`

**Interfaces:**
- `docs/implementation.json` shape:

```json
{
  "updatedAt": "2026-09-02",
  "features": [
    {
      "key": "research",
      "title": "Research",
      "status": "built",
      "summary": "A brief becomes a sourced, verified, approved script on the local model, with three gates.",
      "how": ["planSearch writes one query per claim", "the research service hunts", "the critic keeps or rejects", "you review", "gather, write, verify, revise once, judge coverage"],
      "files": ["lib/reel/research/graph.ts", "lib/reel/research/agents.ts", "app/api/reel/[slug]/research/run/route.ts"],
      "tests": ["tests/research.graph.test.ts", "tests/research.agents.test.ts"],
      "handbook": "#research"
    }
  ]
}
```
`status` ∈ `built | in-progress | designed`. One entry each for: research, plugins-and-gpu, jobs-tab, knowledge-stores, knowledge-spaces, graph-page, agent-memory, how-it-works. Each task in both plans that lands a feature flips its entry to `built` in the same commit.
- `GET /api/about` → the manifest. `GET /api/about?handbook=1` → `docs/handbooks/reels-engine-handbook.html` as `text/html`.
- Sidebar: `{ key: '/about', icon: <ReadOutlined />, label: 'How it works' }` under Library after Plugins.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/about.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('handbook=1')) return { ok: true, text: async () => '<h1>Reels Engine Handbook</h1>' } as Response;
    return { ok: true, json: async () => ({ updatedAt: '2026-09-02', features: [
      { key: 'research', title: 'Research', status: 'built', summary: 'A brief becomes a script.', how: ['plan', 'hunt'], files: ['lib/reel/research/graph.ts'], tests: ['tests/research.graph.test.ts'], handbook: '#research' },
      { key: 'agent-memory', title: 'Agent memory', status: 'in-progress', summary: 'Agents recall.', how: [], files: [], tests: [], handbook: '#knowledge' },
    ] }) } as Response;
  });
});

describe('how it works', () => {
  it('lists every feature with its status, and embeds the handbook', async () => {
    const Page = (await import('@/app/about/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy());
    expect(screen.getByText('built')).toBeTruthy();
    expect(screen.getByText('in-progress')).toBeTruthy();
    expect(screen.getByText('lib/reel/research/graph.ts')).toBeTruthy();
    const frame = screen.getByTitle('Reels Engine Handbook') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/api/about?handbook=1');
  });
});
```

And in `tests/shell.test.tsx` add `expect(screen.getByText('How it works')).toBeTruthy();`.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/about.test.tsx tests/shell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the manifest, the route, the page, the sidebar item**

`docs/implementation.json`: eight entries as listed in Interfaces, with real file and test paths from this repo, statuses as of the moment this task runs (`research`, `plugins-and-gpu`, `jobs-tab`, `knowledge-stores`, `knowledge-spaces`, `graph-page` built; `agent-memory` built after Task 3; `how-it-works` built in this task).

```ts
// app/api/about/route.ts
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/** What is implemented, from a file every feature task updates, plus the handbook itself. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('handbook') === '1') {
    const html = await fs.readFile(path.join(process.cwd(), 'docs', 'handbooks', 'reels-engine-handbook.html'), 'utf8');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const raw = await fs.readFile(path.join(process.cwd(), 'docs', 'implementation.json'), 'utf8');
  return NextResponse.json(JSON.parse(raw));
}
```

```tsx
// app/about/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { Card, Tag, Typography } from 'antd';

type Feature = { key: string; title: string; status: 'built' | 'in-progress' | 'designed'; summary: string; how: string[]; files: string[]; tests: string[]; handbook: string };
const COLOUR = { built: 'green', 'in-progress': 'gold', designed: 'default' } as const;

/** The studio explaining itself: one card per feature, then the handbook in full. */
export default function AboutPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch('/api/about').then((r) => r.json()).then((d) => { setFeatures(d.features ?? []); setUpdatedAt(d.updatedAt ?? ''); });
  }, []);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 2 }}>How it works</Typography.Title>
        <Typography.Text type="secondary">What is implemented, as of {updatedAt || '…'}. The handbook below has the detail.</Typography.Text>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {features.map((f) => (
          <Card key={f.key} size="small" title={<span>{f.title} <Tag color={COLOUR[f.status]}>{f.status}</Tag></span>} extra={<a href={`#handbook`} onClick={(e) => { e.preventDefault(); const fr = document.querySelector<HTMLIFrameElement>('iframe[title="Reels Engine Handbook"]'); if (fr) { fr.src = `/api/about?handbook=1${f.handbook}`; fr.scrollIntoView({ behavior: 'smooth' }); } }}>in the handbook</a>}>
            <Typography.Paragraph style={{ marginBottom: 8 }}>{f.summary}</Typography.Paragraph>
            {f.how.length > 0 && <ol style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13 }}>{f.how.map((h) => <li key={h}>{h}</li>)}</ol>}
            <div style={{ fontSize: 12, display: 'grid', gap: 2 }}>
              {f.files.map((p) => <code key={p}>{p}</code>)}
              {f.tests.map((p) => <code key={p} style={{ opacity: 0.7 }}>{p}</code>)}
            </div>
          </Card>
        ))}
      </div>
      <iframe id="handbook" title="Reels Engine Handbook" src="/api/about?handbook=1" style={{ width: '100%', height: '80vh', border: '1px solid var(--ant-color-border, #ddd)', borderRadius: 8, background: '#fff' }} />
    </div>
  );
}
```

`components/AppShell.tsx`: import `ReadOutlined` and add `{ key: '/about', icon: <ReadOutlined />, label: 'How it works' }` after the Plugins item.

- [ ] **Step 4: Run, expect pass; then look**

Run: `npx vitest run tests/about.test.tsx tests/shell.test.tsx && npx tsc --noEmit -p . && npx eslint app/about app/api/about components/AppShell.tsx`
Expected: PASS, clean. Open `http://localhost:3120/about`: eight cards, then the handbook scrolls inside the frame; "in the handbook" on a card jumps the frame to that section.

- [ ] **Step 5: Commit**

```bash
git add docs/implementation.json app/api/about/route.ts app/about/page.tsx components/AppShell.tsx tests/about.test.tsx tests/shell.test.tsx
git commit -m "feat: a how-it-works tab lists what is built and shows the handbook inside the studio"
```

---

## Self-review

**Spec coverage.** Planner, critic, writer, verifier recall → Tasks 1, 2, 3 (the four blocks, the caps, the citable rule, the Claude path untouched, `knowledgeMemory: false` untouched). Page cap 200,000 → Part 1 Task 5. Card counts → Task 4. Trace shows memory → Task 3. The How-it-works tab is the user's request from 2 September, not in the spec; Task 5 adds it and the manifest that keeps it current. Phases 2 and 3 are out of scope by the spec.

**Placeholders.** Task 2 asks the engineer to read the real anchor line before asserting on it; the code to insert is given. Everything else is complete.

**Type consistency.** `Recall = { block, count }` everywhere. `RecallDeps` in graph.ts names the four functions by the same names Task 1 exports. `verifyScript`'s fifth parameter is a function `(line) => string` in Task 2 and is called that way in Task 3. `storeCounts()` returns `{ nodes, passages, claims }` in Task 1 and is read that way in Task 4.
