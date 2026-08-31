import { promises as fs } from 'fs';
import path from 'path';
import { Beat, REEL_RATIOS, Reel } from './schema';
import { addAsset, loadReel, saveReel, updateAsset } from './store';
import { beatSpans } from './assemble';
import { loadPattern } from './patterns';
import { reelAssetsDir } from '../paths';
import { ffprobeMedia } from './probe';
import { NO_PROVIDER, videoProvider } from './videoProvider';

export type ShotRequest = {
  beatId: string;
  kind: Beat['shot']['kind'];
  brief: string;
  hero: boolean;
  seconds: number;
};

/**
 * Shot kinds a video model may generate.
 *
 * `screen` is excluded on purpose. A screen recording is mostly text, and an image-to-video
 * model redraws text rather than preserving it — a UI screenshot comes back with the words
 * melted into plausible-looking nonsense. The same rule the carousels are built on applies
 * here: diffusion never renders text. Screen beats keep their screenshot and get a camera
 * move over it, which is also what the reference reel does with its captures.
 */
export const GENERATABLE: Beat['shot']['kind'][] = ['broll', 'talking-head'];

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
    if (!GENERATABLE.includes(beat.shot.kind)) continue;
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
 * A video is the shot. An image is ambiguous — it can be the seed a provider animates,
 * or the shot itself with a Ken Burns move over it, which is how half of a real reel is
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
  const asset = await addAsset(slug, {
    kind: 'video',
    path: '',
    origin: 'plugin',
    status: 'queued',
    brief: req.brief,
    width,
    height,
  });
  await pointBeatAt(slug, req.beatId, asset.id);

  try {
    const provider = videoProvider();
    if (!provider || !(await provider.available())) {
      await updateAsset(slug, asset.id, { status: 'awaiting-manual', error: NO_PROVIDER });
      return;
    }

    // A provider animates a still. Prefer the one dropped for this beat, then any spare.
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

    const { jobId } = await provider.animate({
      imagePath: path.join(reelAssetsDir(slug), path.basename(still.path)),
      brief: req.brief,
      seconds: req.seconds,
      seed: reel.seed,
      ratio: reel.ratio,
    });
    await updateAsset(slug, asset.id, { status: 'running', jobId });
  } catch (err) {
    await updateAsset(slug, asset.id, { status: 'failed', error: String(err).slice(0, 300) });
  }
}

/**
 * Promotes each screen beat's own screenshot to being its shot.
 *
 * Nothing is generated for these: the still carries the text intact and ASSEMBLE gives it a
 * camera move, so the UI stays readable.
 */
export async function useStillsForScreens(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  for (const beat of reel.beats) {
    if (beat.shot.kind !== 'screen' || beat.shot.assetId) continue;
    const still = reel.assets.find(
      (a) => a.kind === 'image' && a.status === 'ready' && a.brief === `still:${beat.id}`
    );
    if (still) await pointBeatAt(slug, beat.id, still.id);
  }
  return loadReel(slug);
}

/** Queues every beat that still needs footage. Idempotent: pending beats are skipped. */
export async function runShots(slug: string): Promise<Reel> {
  await useStillsForScreens(slug);
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  for (const req of planShots(reel, pattern.pacing.shotSec)) {
    await generateOne(slug, req, await loadReel(slug));
  }
  return loadReel(slug);
}

/** Moves running provider jobs forward; called by the studio while it polls. */
export async function refreshShots(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const provider = videoProvider();
  // Without a provider nothing can be running, and polling one would be a lie.
  if (!provider) return reel;
  for (const asset of reel.assets) {
    if (asset.status !== 'running' || !asset.jobId) continue;
    const state = await provider.jobState(asset.jobId);
    if (state === 'ready') {
      const rel = path.join('assets', `${asset.id}.mp4`);
      try {
        await provider.collect(asset.jobId, path.join(reelAssetsDir(slug), `${asset.id}.mp4`));
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
      await updateAsset(slug, asset.id, { status: 'failed', error: `${provider.name} reported an error` });
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
