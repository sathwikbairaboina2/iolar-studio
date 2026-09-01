import { listReels, loadReel } from '../reel/store';
import type { Reel } from '../reel/schema';

/**
 * Every render the studio is waiting on, across every reel.
 *
 * The reel files already carry the truth — which beat asked for a shot, which plugin took it,
 * what job id came back — so this is a join rather than a second source. Reading the plugins'
 * own job lists instead would show jobs the studio has already moved past.
 */

export type JobRow = {
  slug: string;
  reel: string;
  beatId: string;
  says: string;
  kind: string;
  plugin: string;
  assetId: string;
  jobId?: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'awaiting-manual';
  durationSec?: number;
  error?: string;
};

export type Blocked = { slug: string; reel: string; beatId: string; says: string; why: string };

export type JobBoard = {
  rows: JobRow[];
  blocked: Blocked[];
  counts: { running: number; queued: number; ready: number; failed: number; awaitingManual: number };
};

const ROLE_OF = (reel: Reel, assetId: string) => reel.beats.find((b) => b.shot.assetId === assetId);

function rowsFor(slug: string, reel: Reel): { rows: JobRow[]; blocked: Blocked[] } {
  const rows: JobRow[] = [];
  const blocked: Blocked[] = [];

  for (const asset of reel.assets) {
    if (asset.origin !== 'plugin') continue;
    const beat = ROLE_OF(reel, asset.id);
    if (!beat) continue;
    const row: JobRow = {
      slug,
      reel: reel.title,
      beatId: beat.id,
      says: beat.text,
      kind: beat.shot.kind,
      plugin: asset.provider ?? 'unknown',
      assetId: asset.id,
      jobId: asset.jobId,
      status: asset.status,
      durationSec: asset.durationSec,
      error: asset.error,
    };
    rows.push(row);
    if (asset.status === 'awaiting-manual') {
      blocked.push({ slug, reel: reel.title, beatId: beat.id, says: beat.text, why: asset.error ?? 'waiting for a file' });
    }
  }

  // A beat that can be rendered but has nothing pointing at it has not been queued at all.
  for (const beat of reel.beats) {
    if (beat.shot.assetId) continue;
    if (beat.shot.kind !== 'screen' && beat.shot.kind !== 'talking-head') continue;
    blocked.push({ slug, reel: reel.title, beatId: beat.id, says: beat.text, why: 'never queued — it has no shot yet' });
  }

  return { rows, blocked };
}

/** The board: what is running, what landed, and what is waiting on a person. */
export async function readJobs(): Promise<JobBoard> {
  const reels = await listReels();
  const rows: JobRow[] = [];
  const blocked: Blocked[] = [];

  for (const entry of reels) {
    const reel = await loadReel(entry.slug).catch(() => null);
    if (!reel) continue;
    const part = rowsFor(entry.slug, reel);
    rows.push(...part.rows);
    blocked.push(...part.blocked);
  }

  // Running first, then whatever is queued behind it, then the rest: the page is read from
  // the top when something is on the GPU.
  const rank = { running: 0, queued: 1, failed: 2, 'awaiting-manual': 3, ready: 4 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status]);

  return {
    rows,
    blocked,
    counts: {
      running: rows.filter((r) => r.status === 'running').length,
      queued: rows.filter((r) => r.status === 'queued').length,
      ready: rows.filter((r) => r.status === 'ready').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      awaitingManual: rows.filter((r) => r.status === 'awaiting-manual').length,
    },
  };
}
