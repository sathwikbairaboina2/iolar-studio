import { promises as fs } from 'fs';
import path from 'path';
import { Beat, REEL_RATIOS, Reel } from './schema';
import { addAsset, loadReel, saveReel, updateAsset } from './store';
import { beatSpans } from './assemble';
import { loadPattern } from './patterns';
import { reelAssetsDir } from '../paths';
import { getSettings } from '../settings';
import { ffprobeMedia } from './probe';
import { animateImage, collectVideo, i2vAvailable, jobState } from '../comfy/i2v';
import { HiggsfieldUnavailableError, downloadTo, hfGenerateVideo } from '../higgsfield/client';

export type ShotRequest = {
  beatId: string;
  kind: Beat['shot']['kind'];
  brief: string;
  hero: boolean;
  seconds: number;
};

/**
 * Beats still needing footage. Title beats are overlays, not clips, so they never queue.
 *
 * A beat that already points at an asset is left alone whatever its state — including
 * `failed` and `awaiting-manual`, which are waiting on a human, not on another attempt.
 * `retryShot` clears the pointer when someone actually asks for a re-run.
 */
export function planShots(reel: Reel, shotSec: [number, number]): ShotRequest[] {
  const known = new Set(reel.assets.map((a) => a.id));
  const spans = beatSpans(reel);
  const [lo, hi] = shotSec;
  const out: ShotRequest[] = [];

  for (const beat of reel.beats) {
    if (beat.shot.kind === 'title') continue;
    const id = beat.shot.assetId;
    if (id && known.has(id)) continue;
    const span = spans.get(beat.id);
    const spoken = span ? span.end - span.start : lo;
    out.push({
      beatId: beat.id,
      kind: beat.shot.kind,
      brief: beat.shot.brief,
      hero: beat.shot.hero,
      seconds: Math.round(Math.min(hi, Math.max(lo, spoken)) * 10) / 10,
    });
  }
  return out;
}

async function pointBeatAt(slug: string, beatId: string, assetId: string): Promise<void> {
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    beats: reel.beats.map((b) => (b.id === beatId ? { ...b, shot: { ...b.shot, assetId } } : b)),
  });
}

export type DropRole = 'shot' | 'still';

/**
 * A dropped file always wins over generation for its beat.
 *
 * A video is the shot. An image is ambiguous — it can be the seed ComfyUI animates, or
 * the shot itself with a Ken Burns move over it, which is how half of a real reel is
 * built. `role` says which; images default to seeding.
 */
export async function attachAsset(
  slug: string,
  beatId: string,
  file: { name: string; bytes: Buffer },
  role: DropRole = 'still'
): Promise<Reel> {
  const dir = reelAssetsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(file.name) || '.mp4';
  const safe = `${beatId}-${Date.now()}${ext}`;
  const dest = path.join(dir, safe);
  await fs.writeFile(dest, file.bytes);

  const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(ext);
  let info = { durationSec: 0, width: 0, height: 0 };
  try {
    const probed = await ffprobeMedia(dest);
    info = { durationSec: probed.durationSec, width: probed.width, height: probed.height };
  } catch {
    // An un-probeable drop still attaches; the studio shows it and the export will complain.
  }

  const asset = await addAsset(slug, {
    kind: isVideo ? 'video' : 'image',
    path: path.join('assets', safe),
    origin: 'user',
    status: 'ready',
    brief: isVideo || role === 'shot' ? 'dropped by hand' : `still:${beatId}`,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
  });
  if (isVideo || role === 'shot') await pointBeatAt(slug, beatId, asset.id);
  return loadReel(slug);
}

async function generateOne(slug: string, req: ShotRequest, reel: Reel): Promise<void> {
  const [width, height] = REEL_RATIOS[reel.ratio];
  // A hero shot only leaves this machine when heroProvider says so; the default keeps
  // every generation on the local ComfyUI.
  const useHiggsfield = req.hero && getSettings().heroProvider === 'higgsfield';
  const asset = await addAsset(slug, {
    kind: 'video',
    path: '',
    origin: useHiggsfield ? 'higgsfield' : 'comfy',
    status: 'queued',
    brief: req.brief,
    width,
    height,
  });
  await pointBeatAt(slug, req.beatId, asset.id);

  try {
    if (useHiggsfield) {
      const { url } = await hfGenerateVideo({ prompt: req.brief, seconds: req.seconds });
      const rel = path.join('assets', `${asset.id}.mp4`);
      await downloadTo(url, path.join(reelAssetsDir(slug), `${asset.id}.mp4`));
      await updateAsset(slug, asset.id, { path: rel, status: 'ready' });
      return;
    }

    if (!(await i2vAvailable())) {
      await updateAsset(slug, asset.id, {
        status: 'awaiting-manual',
        error: 'ComfyUI is not reachable — generate this shot yourself and drop the file in.',
      });
      return;
    }

    // ComfyUI animates a still. Prefer the one dropped for this beat, then any spare.
    const still =
      reel.assets.find(
        (a) => a.kind === 'image' && a.status === 'ready' && a.brief === `still:${req.beatId}`
      ) ?? reel.assets.find((a) => a.kind === 'image' && a.status === 'ready');
    if (!still) {
      await updateAsset(slug, asset.id, {
        status: 'awaiting-manual',
        error: 'No source screenshot for this beat — drop an image and retry.',
      });
      return;
    }

    const { promptId } = await animateImage({
      imagePath: path.join(reelAssetsDir(slug), path.basename(still.path)),
      brief: req.brief,
      seconds: req.seconds,
      seed: reel.seed,
      ratio: reel.ratio,
    });
    await updateAsset(slug, asset.id, { status: 'running', jobId: promptId });
  } catch (err) {
    const manual = err instanceof HiggsfieldUnavailableError;
    await updateAsset(slug, asset.id, {
      status: manual ? 'awaiting-manual' : 'failed',
      error: String(err).slice(0, 300),
    });
  }
}

/** Queues every beat that still needs footage. Idempotent: pending beats are skipped. */
export async function runShots(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  for (const req of planShots(reel, pattern.pacing.shotSec)) {
    await generateOne(slug, req, await loadReel(slug));
  }
  return loadReel(slug);
}

/** Moves running ComfyUI jobs forward; called by the studio while it polls. */
export async function refreshShots(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  for (const asset of reel.assets) {
    if (asset.status !== 'running' || !asset.jobId) continue;
    const state = await jobState(asset.jobId);
    if (state === 'ready') {
      const rel = path.join('assets', `${asset.id}.mp4`);
      try {
        await collectVideo(asset.jobId, path.join(reelAssetsDir(slug), `${asset.id}.mp4`));
        const info = await ffprobeMedia(path.join(reelAssetsDir(slug), `${asset.id}.mp4`)).catch(() => null);
        await updateAsset(slug, asset.id, {
          path: rel,
          status: 'ready',
          durationSec: info?.durationSec,
          width: info?.width,
          height: info?.height,
        });
      } catch (err) {
        await updateAsset(slug, asset.id, { status: 'failed', error: String(err).slice(0, 300) });
      }
    } else if (state === 'failed') {
      await updateAsset(slug, asset.id, { status: 'failed', error: 'ComfyUI reported an error' });
    }
  }
  return loadReel(slug);
}

/** Clears a beat's asset so the next run queues it again, optionally with a new brief. */
export async function retryShot(slug: string, beatId: string, brief?: string): Promise<Reel> {
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    beats: reel.beats.map((b) =>
      b.id === beatId
        ? { ...b, shot: { ...b.shot, brief: brief ?? b.shot.brief, assetId: undefined } }
        : b
    ),
  });
  return runShots(slug);
}
