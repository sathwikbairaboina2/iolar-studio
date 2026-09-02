import type { WeekView } from '@/lib/jobs/board';
import { getStores } from '../stores';
import { safely } from '../index';
import { topicKey } from '../topics';

/**
 * The jobs space: one Week per board week, with the employers, functions, cities and
 * work modes it listed, counted, and the planner's ranked highlights as shared topics.
 * Read from the board, never from the plugin's disk.
 */

const weekRef = (week: string) => ({ label: 'Week', key: { week } });

const count = <T>(items: T[], by: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = by(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};

export async function recordWeek(view: WeekView): Promise<void> {
  await safely('jobs.recordWeek', async () => {
    const { graph } = getStores();
    const jobs = view.jobs?.jobs ?? [];
    await graph.mergeNode(
      'Week',
      { week: view.week },
      {
        space: 'jobs',
        stage: view.stage,
        counted: jobs.length,
        rejected: view.jobs?.rejected.length ?? 0,
        style: view.reel?.style ?? null,
        world: view.reel?.world ?? null,
        hasExport: view.hasExport,
      }
    );
    for (const [name, n] of count(jobs, (j) => j.company.trim())) {
      await graph.mergeNode('Employer', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'LISTS', { label: 'Employer', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.function)) {
      await graph.mergeNode('Function', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'IN', { label: 'Function', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.location.trim())) {
      await graph.mergeNode('City', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'IN', { label: 'City', key: { name } }, { count: n });
    }
    for (const [name, n] of count(jobs, (j) => j.workMode)) {
      await graph.mergeNode('WorkMode', { name }, { space: 'jobs' });
      await graph.mergeEdge(weekRef(view.week), 'MODE', { label: 'WorkMode', key: { name } }, { count: n });
    }
    for (const h of view.reel?.highlights ?? []) {
      const key = topicKey(h.highlight.replace(/-/g, ' '));
      if (key.length < 3) continue;
      await graph.mergeNode('Topic', { key }, { space: 'shared', label: h.highlight });
      await graph.mergeEdge(weekRef(view.week), 'HIGHLIGHT', { label: 'Topic', key: { key } }, { score: h.score, scene: h.scene });
    }
  });
}

/** A cut the studio prepared and submitted, linked to the week it fed and the pull it came from. */
export async function recordCut(
  cut: { id: number; periodKey: string; kind: string; counted: number; rejected: number; status: string },
  pullId: number | null
): Promise<void> {
  await safely('jobs.recordCut', async () => {
    const { graph } = getStores();
    await graph.mergeNode(
      'Cut',
      { id: cut.id },
      { space: 'jobs', periodKey: cut.periodKey, kind: cut.kind, counted: cut.counted, rejected: cut.rejected, status: cut.status }
    );
    await graph.mergeNode('Week', { week: cut.periodKey }, { space: 'jobs' });
    await graph.mergeEdge({ label: 'Cut', key: { id: cut.id } }, 'FROM_POOL', weekRef(cut.periodKey), { pullId: pullId ?? null });
  });
}

/** The stage a week was last indexed at, or null if the graph has never seen it. */
export async function indexedStage(week: string): Promise<string | null> {
  const { graph } = getStores();
  const rows = await graph.query<{ stage: string }>(`MATCH (w:Week {week: $week}) RETURN w.stage AS stage`, { week });
  return rows[0]?.stage ?? null;
}
