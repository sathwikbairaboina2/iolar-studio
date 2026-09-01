import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';
import { siftCandidates, withStableIds } from '@/lib/reel/research/candidate';
import { critique, draftScript, huntSources, judgeCoverage, planSearch } from '@/lib/reel/research/agents';
import { briefWithPlan, parsePlan } from '@/lib/reel/research/plan';
import { huntLocally } from '@/lib/reel/research/local';
import { appendTrace, clearTrace, traceFromTool } from '@/lib/reel/research/trace';
import { getSettings } from '@/lib/settings';
import { gatherEvidence } from '@/lib/reel/research/gatherRun';
import { parseBrief } from '@/lib/reel/research/brief';
import { unsupportedClaims } from '@/lib/reel/research/script';
import { effectiveState } from '@/lib/reel/research/selection';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Research runs long: subagents searching the web is minutes, not seconds.
 *
 * One call advances one stage, so this has to clear the slowest single stage —
 * the hunt at 900s — rather than the sum of them. It used to be 800 against a
 * hunt-plus-critic pair that could ask for 900.
 */
export const maxDuration = 960;

/**
 * Advances the research one stage.
 *
 * The state machine lives here rather than in the browser: the brief's status
 * decides what runs next, so a closed tab or a refresh costs nothing, and the
 * two gates — review and approval — stop the server from running past a
 * decision that is the user's to make.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  try {
    // The first call carries the brief the wizard collected.
    if (body.brief) {
      const brief = parseBrief({ ...body.brief, runId: slug, status: 'briefed' });
      await store.writeBrief(slug, brief);
      return NextResponse.json({ status: 'briefed', waitingOn: null, done: false });
    }

    const status = await store.researchStatus(slug);
    if (!status) {
      return NextResponse.json(
        { error: 'no research for this reel yet — send the brief first' },
        { status: 400 }
      );
    }

    const brief = await store.readBrief(slug);

    // The strategy comes first, and it is a gate: the queries the hunt will run are
    // written down, shown, and edited by a person before a single search happens. A
    // pack with no visible strategy behind it is not one to trust.
    if (status === 'briefed') {
      await clearTrace(slug);
      const plan = await planSearch(brief);
      await store.writePlan(slug, plan);
      await store.setResearchStatus(slug, 'planned');
      await appendTrace(slug, { stage: 'plan', kind: 'note', text: `planned ${plan.queries.length} queries` });
      return NextResponse.json({ status: 'planned', waitingOn: 'plan', done: false, plan });
    }

    // The hunt is the expensive half and lands on disk on its own, so a critic
    // that fails is retried against what was already found rather than sending
    // every hunter out again. It runs only when the plan comes back approved —
    // possibly edited — in the body; a bare call at this stage is the gate holding.
    if (status === 'planned') {
      if (!body.plan) {
        return NextResponse.json({ status, waitingOn: 'plan', done: false, plan: await store.readPlan(slug) });
      }
      const plan = parsePlan({ ...body.plan, runId: slug, generatedAt: body.plan.generatedAt ?? new Date().toISOString() });
      await store.writePlan(slug, plan);
      const armed = briefWithPlan(brief, plan);
      await store.writeBrief(slug, armed);

      const settings = getSettings();
      await appendTrace(slug, {
        stage: 'hunt',
        kind: 'note',
        text: `hunting with ${settings.researchProvider === 'local' ? 'the local research service' : 'Claude subagents'}: ${plan.queries.length} queries`,
      });
      const found =
        settings.researchProvider === 'local'
          ? await huntLocally(armed, plan, {
              baseUrl: settings.researchUrl,
              onStep: (ev) => void appendTrace(slug, { stage: 'hunt', ...ev }),
            })
          : await huntSources(armed, undefined, (call) => {
              const ev = traceFromTool(call.name, call.input);
              if (ev) void appendTrace(slug, { stage: 'hunt', ...ev });
            });
      await store.writeHunt(slug, found);
      await store.setResearchStatus(slug, 'hunted');
      await appendTrace(slug, { stage: 'hunt', kind: 'note', text: `hunt returned ${found.length} sources` });
      return NextResponse.json({ status: 'hunted', waitingOn: null, done: false, found: found.length });
    }

    if (status === 'hunted') {
      const raw = await store.readHunt(slug);
      const judged = await critique(brief, raw);
      // One row the critic shaped wrong used to cost the whole pack, and every
      // minute spent finding it. Drop it, count it, keep the rest.
      const { kept, dropped } = siftCandidates(judged.candidates ?? []);
      if (kept.length === 0) {
        return NextResponse.json(
          {
            error: dropped.length
              ? `the critic returned ${dropped.length} source(s), none usable — first: ${dropped[0].issue}`
              : 'the critic returned no sources',
          },
          { status: 400 }
        );
      }
      // Ids come from the URL, not from the model that invented the rest.
      const candidates = withStableIds(kept);
      await store.writeCandidates(slug, {
        runId: slug,
        generatedAt: new Date().toISOString(),
        criticVersion: '1',
        stats: {
          perClass: {},
          totalFound: raw.length,
          totalKept: candidates.filter((c) => c.verdict === 'keep').length,
          dupesCollapsed: candidates.filter((c) => c.dupeOf).length,
        },
        // Only the candidates are the model's to give. The critic's prompt used
        // to ask it for stats too, and spreading them here overwrote the counts
        // computed above with whatever shape it invented — a perClass of plain
        // numbers, which failed validation after eleven minutes of searching.
        candidates,
      } as never);
      await store.setResearchStatus(slug, 'critiqued');
      return NextResponse.json({
        status: 'critiqued',
        waitingOn: 'review',
        done: false,
        kept: candidates.length,
        dropped: dropped.length,
      });
    }

    // Gate: nothing is gathered or written until the user has kept something.
    if (status === 'critiqued') {
      return NextResponse.json({ status, waitingOn: 'review', done: false });
    }

    if (status === 'reviewed') {
      const [{ candidates }, selection] = await Promise.all([
        store.readCandidates(slug),
        store.readSelection(slug),
      ]);
      const kept = candidates.filter((c) => effectiveState(c, selection) === 'keep');
      const gathered = await gatherEvidence(slug, kept);
      await store.setResearchStatus(slug, 'gathered');
      return NextResponse.json({ status: 'gathered', gathered, waitingOn: null, done: false });
    }

    if (status === 'gathered') {
      const [{ candidates }, selection, evidence] = await Promise.all([
        store.readCandidates(slug),
        store.readSelection(slug),
        store.readAllEvidence(slug),
      ]);
      const kept = candidates.filter((c) => effectiveState(c, selection) === 'keep');
      const lines = await draftScript(brief, kept, evidence);
      const now = new Date().toISOString();

      // Whether the script makes the brief's claims is a reading question, so the
      // model reads it. Keyword overlap is the fallback for when it cannot.
      let coverage: Awaited<ReturnType<typeof judgeCoverage>> = [];
      let unsupported: string[];
      try {
        coverage = await judgeCoverage(brief.mustProve, lines);
        unsupported = coverage.filter((c) => c.lineIds.length === 0).map((c) => c.claim);
      } catch {
        coverage = [];
        unsupported = unsupportedClaims(brief.mustProve, lines);
      }

      await store.writeScript(slug, {
        runId: slug,
        createdAt: now,
        updatedAt: now,
        status: 'draft',
        lines,
        unsupported,
        coverage,
      } as never);
      await store.setResearchStatus(slug, 'drafted');
      return NextResponse.json({ status: 'drafted', waitingOn: 'approval', done: false });
    }

    if (status === 'drafted') {
      return NextResponse.json({ status, waitingOn: 'approval', done: false });
    }

    return NextResponse.json({ status: 'approved', waitingOn: null, done: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
