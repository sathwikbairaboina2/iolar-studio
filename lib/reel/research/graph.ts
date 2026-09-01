import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import * as store from './store';
import { critique, draftScript, judgeCoverage, planSearch, type Runner } from './agents';
import { briefWithPlan, parsePlan, type SearchPlan } from './plan';
import { huntLocally } from './local';
import { gatherEvidence } from './gatherRun';
import { siftCandidates, withStableIds } from './candidate';
import { effectiveState } from './selection';
import { unsupportedClaims } from './script';
import { appendTrace, clearTrace } from './trace';
import type { Brief } from './brief';
import type { Candidate } from './candidate';
import type { ScriptLine } from './script';
import type { Coverage } from './agents';

/**
 * The research as a graph, on the local model.
 *
 * Six agents in a row — planner, hunter, critic, gatherer, writer, judge — with three
 * places a person has to say yes before the next one runs: the plan, the review of the
 * pack, and the script. The graph is the wiring; each agent is the same function the
 * Claude path calls, handed a qwen runner instead. The hunter is the research service,
 * which is itself an agent loop over a local model with tools.
 *
 * Gates are edges to END. The route invokes the graph once per advance; the graph reads
 * where the research stopped and runs the stretch up to the next gate, writing each
 * stage to disk as it goes so a crash mid-stretch loses one stage, not the run.
 */

export const ResearchState = Annotation.Root({
  slug: Annotation<string>,
  brief: Annotation<Brief>,
  status: Annotation<Brief['status']>,
  /** A plan the person sent back approved, possibly edited. Present only on the hunt advance. */
  approvedPlan: Annotation<SearchPlan | null>({ value: (_, b) => b, default: () => null }),
  plan: Annotation<SearchPlan | null>({ value: (_, b) => b, default: () => null }),
  found: Annotation<Record<string, unknown>[]>({ value: (_, b) => b, default: () => [] }),
  candidates: Annotation<Candidate[]>({ value: (_, b) => b, default: () => [] }),
  lines: Annotation<ScriptLine[]>({ value: (_, b) => b, default: () => [] }),
  coverage: Annotation<Coverage[]>({ value: (_, b) => b, default: () => [] }),
  /** What the last advance produced, for the route's reply. */
  note: Annotation<Record<string, unknown>>({ value: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
});

export type ResearchStateT = typeof ResearchState.State;

export type GraphDeps = {
  /** The model every thinking agent uses. */
  run: Runner;
  /** Where the hunter lives. */
  researchUrl: string;
  fetchImpl?: typeof fetch;
  huntPollMs?: number;
};

export function buildResearchGraph(deps: GraphDeps) {
  const plan = async (s: ResearchStateT) => {
    await clearTrace(s.slug);
    const plan = await planSearch(s.brief, deps.run);
    await store.writePlan(s.slug, plan);
    await store.setResearchStatus(s.slug, 'planned');
    await appendTrace(s.slug, { stage: 'plan', kind: 'note', text: `planned ${plan.queries.length} queries on the local model` });
    return { plan, status: 'planned' as const, note: { waitingOn: 'plan', plan } };
  };

  const hunt = async (s: ResearchStateT) => {
    const plan = parsePlan({ ...s.approvedPlan, runId: s.slug, generatedAt: s.approvedPlan?.generatedAt ?? new Date().toISOString() });
    await store.writePlan(s.slug, plan);
    const armed = briefWithPlan(s.brief, plan);
    await store.writeBrief(s.slug, armed);
    await appendTrace(s.slug, { stage: 'hunt', kind: 'note', text: `hunting with the local research service: ${plan.queries.length} queries` });
    const found = await huntLocally(armed, plan, {
      baseUrl: deps.researchUrl,
      fetchImpl: deps.fetchImpl,
      pollMs: deps.huntPollMs,
      onStep: (ev) => void appendTrace(s.slug, { stage: 'hunt', ...ev }),
    });
    await store.writeHunt(s.slug, found);
    await store.setResearchStatus(s.slug, 'hunted');
    await appendTrace(s.slug, { stage: 'hunt', kind: 'note', text: `hunt returned ${found.length} sources` });
    return { brief: armed, found, status: 'hunted' as const, note: { found: found.length } };
  };

  const judgePack = async (s: ResearchStateT) => {
    const raw = s.found.length ? s.found : await store.readHunt(s.slug);
    const judged = await critique(s.brief, raw, deps.run);
    const { kept, dropped } = siftCandidates(judged.candidates ?? []);
    if (kept.length === 0) {
      throw new Error(
        dropped.length
          ? `the critic returned ${dropped.length} source(s), none usable — first: ${dropped[0].issue}`
          : 'the critic returned no sources'
      );
    }
    const candidates = withStableIds(kept);
    await store.writeCandidates(s.slug, {
      runId: s.slug,
      generatedAt: new Date().toISOString(),
      criticVersion: '1',
      stats: {
        perClass: {},
        totalFound: raw.length,
        totalKept: candidates.filter((c) => c.verdict === 'keep').length,
        dupesCollapsed: candidates.filter((c) => c.dupeOf).length,
      },
      candidates,
    } as never);
    await store.setResearchStatus(s.slug, 'critiqued');
    return { candidates, status: 'critiqued' as const, note: { waitingOn: 'review', kept: candidates.length, dropped: dropped.length } };
  };

  const gather = async (s: ResearchStateT) => {
    const [{ candidates }, selection] = await Promise.all([store.readCandidates(s.slug), store.readSelection(s.slug)]);
    const kept = candidates.filter((c) => effectiveState(c, selection) === 'keep');
    const gathered = await gatherEvidence(s.slug, kept);
    await store.setResearchStatus(s.slug, 'gathered');
    return { candidates: kept, status: 'gathered' as const, note: { gathered } };
  };

  const write = async (s: ResearchStateT) => {
    const kept = s.candidates.length
      ? s.candidates
      : await (async () => {
          const [{ candidates }, selection] = await Promise.all([store.readCandidates(s.slug), store.readSelection(s.slug)]);
          return candidates.filter((c) => effectiveState(c, selection) === 'keep');
        })();
    const evidence = await store.readAllEvidence(s.slug);
    const lines = await draftScript(s.brief, kept, evidence, deps.run);
    return { lines, candidates: kept };
  };

  const judgeScript = async (s: ResearchStateT) => {
    let coverage: Coverage[] = [];
    let unsupported: string[];
    try {
      coverage = await judgeCoverage(s.brief.mustProve, s.lines, deps.run);
      unsupported = coverage.filter((c) => c.lineIds.length === 0).map((c) => c.claim);
    } catch {
      unsupported = unsupportedClaims(s.brief.mustProve, s.lines);
    }
    const now = new Date().toISOString();
    await store.writeScript(s.slug, {
      runId: s.slug,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      lines: s.lines,
      unsupported,
      coverage,
    } as never);
    await store.setResearchStatus(s.slug, 'drafted');
    return { coverage, status: 'drafted' as const, note: { waitingOn: 'approval', unsupported: unsupported.length } };
  };

  /** Where to start, from where the research stopped. */
  const entry = (s: ResearchStateT): string => {
    switch (s.status) {
      case 'briefed':
        return 'planSearch';
      case 'planned':
        return s.approvedPlan ? 'hunt' : END;
      case 'hunted':
        return 'judgePack';
      case 'reviewed':
        return 'gather';
      case 'gathered':
        return 'write';
      default:
        return END;
    }
  };

  return new StateGraph(ResearchState)
    .addNode('planSearch', plan)
    .addNode('hunt', hunt)
    .addNode('judgePack', judgePack)
    .addNode('gather', gather)
    .addNode('write', write)
    .addNode('judgeScript', judgeScript)
    .addConditionalEdges(START, entry, ['planSearch', 'hunt', 'judgePack', 'gather', 'write', END])
    .addEdge('planSearch', END) // gate: the plan
    .addEdge('hunt', 'judgePack')
    .addEdge('judgePack', END) // gate: the review
    .addEdge('gather', 'write')
    .addEdge('write', 'judgeScript')
    .addEdge('judgeScript', END) // gate: the approval
    .compile();
}

/**
 * One advance: from wherever the research stopped, to the next gate.
 *
 * The reply mirrors the legacy route's so the panel needs no second shape: status,
 * what it is waiting on, and whatever the stretch produced.
 */
export async function advanceResearch(
  slug: string,
  deps: GraphDeps,
  body: { plan?: unknown } = {}
): Promise<{ status: Brief['status']; waitingOn: string | null; done: boolean } & Record<string, unknown>> {
  const brief = await store.readBrief(slug);
  const graph = buildResearchGraph(deps);
  const out = await graph.invoke({
    slug,
    brief,
    status: brief.status,
    approvedPlan: body.plan ? (body.plan as SearchPlan) : null,
  });
  const status = out.status;
  const gate: Record<string, string> = { planned: 'plan', critiqued: 'review', drafted: 'approval' };
  const waitingOn = (out.note.waitingOn as string | undefined) ?? gate[status] ?? null;
  const { waitingOn: _w, ...rest } = out.note;
  return { status, waitingOn, done: status === 'approved', ...rest };
}
