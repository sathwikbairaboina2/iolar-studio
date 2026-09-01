import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import * as store from './store';
import { critique, draftScript, judgeCoverage, planSearch, verifyScript, type Flag, type Runner } from './agents';
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
  flags: Annotation<Flag[]>({ value: (_, b) => b, default: () => [] }),
  /** How many times the writer has been sent back by the verifier. */
  revisions: Annotation<number>({ value: (_, b) => b, default: () => 0 }),
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
    let lines = await draftScript(s.brief, kept, evidence, deps.run);
    // A local model told "120-160 words" comes back with 80 one time in three. One
    // retry with the shortfall spelled out; after that the draft stands and a person
    // sees the count.
    const words = (ls: ScriptLine[]) => ls.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
    if (words(lines) < 110) {
      const shortfall = `The previous draft was ${words(lines)} words — too short. Write 130-150 spoken words this time: more of the evidence, one fact per line.`;
      const again = await draftScript(s.brief, kept, evidence, deps.run, shortfall).catch(() => lines);
      if (words(again) > words(lines)) lines = again;
    }
    return { lines, candidates: kept };
  };

  const verify = async (s: ResearchStateT) => {
    const evidence = await store.readAllEvidence(s.slug);
    let flags: Flag[] = [];
    try {
      flags = await verifyScript(s.lines, s.candidates, evidence, deps.run);
    } catch {
      // A verifier that cannot answer flags nothing; the script still lands, unmarked,
      // rather than the whole stretch dying on the last agent.
      flags = [];
    }
    return { flags };
  };

  /**
   * The writer, sent back with the verifier's objections.
   *
   * One round: the flags say exactly which line says what its source does not, and a
   * model handed that fixes most of them. A second round rarely earns its minutes, and a
   * line still flagged after one is a line a person should look at anyway.
   */
  const revise = async (s: ResearchStateT) => {
    const evidence = await store.readAllEvidence(s.slug);
    const objections = s.flags
      .map((f) => {
        const line = s.lines.find((l) => l.id === f.lineId);
        return `- "${line?.text ?? f.lineId}": ${f.issue}`;
      })
      .join('\n');
    const redo = `A verifier read the previous draft against the sources and rejected these lines. Fix each one so it says only what its cited source says — or cut it, or mark it commentary:\n${objections}`;
    const lines = await draftScript(s.brief, s.candidates, evidence, deps.run, redo).catch(() => s.lines);
    return { lines, revisions: s.revisions + 1 };
  };

  const afterVerify = (s: ResearchStateT): string => (s.flags.length && s.revisions < 1 ? 'revise' : 'judgeScript');

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
      flags: s.flags,
    } as never);
    await store.setResearchStatus(s.slug, 'drafted');
    return { coverage, status: 'drafted' as const, note: { waitingOn: 'approval', unsupported: unsupported.length, flagged: s.flags.length, revisions: s.revisions } };
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
    .addNode('verify', verify)
    .addNode('revise', revise)
    .addNode('judgeScript', judgeScript)
    .addConditionalEdges(START, entry, ['planSearch', 'hunt', 'judgePack', 'gather', 'write', END])
    .addEdge('planSearch', END) // gate: the plan
    .addEdge('hunt', 'judgePack')
    .addEdge('judgePack', END) // gate: the review
    .addEdge('gather', 'write')
    .addEdge('write', 'verify')
    .addConditionalEdges('verify', afterVerify, ['revise', 'judgeScript'])
    .addEdge('revise', 'verify')
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
