import { promises as fs } from 'fs';
import path from 'path';
import { Beat, REEL_RATIOS, Reel } from './schema';
import { addAsset, loadReel, saveReel, updateAsset } from './store';
import { beatSpans } from './assemble';
import { loadPattern } from './patterns';
import { reelAssetsDir } from '../paths';
import { ffprobeMedia } from './probe';
import { NO_PROVIDER, providerNameFor, videoProvider } from './videoProvider';
import { resolveLink } from './build/links';
import { beatAudioFile } from './build/audio';
import { getSettings } from '../settings';
import * as research from './research/store';
import type { Candidate } from './research/candidate';
import type { Script } from './research/script';

export type ShotRequest = {
  beatId: string;
  kind: Beat['shot']['kind'];
  brief: string;
  hero: boolean;
  seconds: number;
  /** The approved line behind this beat, if it came from one. */
  sourceLineId: string | null;
};

/**
 * Shot kinds a renderer can produce.
 *
 * `screen` used to be excluded because an image-to-video model redraws text
 * rather than preserving it, and a UI screenshot came back with the words melted
 * into nonsense. That reasoning does not apply to a real browser rendering a real
 * page, so with the pages renderer doing the work the exclusion inverts: screen
 * is now the best-served kind there is.
 *
 * `broll` leaves the list because neither renderer makes generic b-roll, and a
 * researched reel is planned without it.
 */
export const GENERATABLE: Beat['shot']['kind'][] = ['screen', 'talking-head'];

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
      sourceLineId: beat.shot.sourceLineId ?? null,
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

/** What a run needs to turn beats into jobs, loaded once rather than per beat. */
type BuildContext = {
  script: Pick<Script, 'lines'> | null;
  candidates: Candidate[];
  presenterImage: string;
  /** Asked once per run: a renderer busy with beat one is not missing for beat six. */
  up: Map<string, boolean>;
};

async function buildContext(slug: string): Promise<BuildContext> {
  const presenterImage = getSettings().presenterImage;
  // A reel planned from a topic has no research behind it, and a pack that fails
  // to load is not the same failure as a script that does — reporting "its line
  // cites nothing" for a corrupt candidates file sends you looking in the wrong
  // place.
  const script = await research.readScript(slug).catch(() => null);
  const pack = await research.readCandidates(slug).catch(() => null);
  return { script, candidates: pack?.candidates ?? [], presenterImage, up: new Map() };
}

async function generateOne(slug: string, req: ShotRequest, reel: Reel, ctx: BuildContext): Promise<void> {
  const [width, height] = REEL_RATIOS[reel.ratio];
  const providerName = providerNameFor(req.kind);
  const asset = await addAsset(slug, {
    kind: 'video',
    path: '',
    origin: 'plugin',
    status: 'queued',
    brief: req.brief,
    provider: providerName ?? undefined,
    width,
    height,
  });
  await pointBeatAt(slug, req.beatId, asset.id);

  const stall = (error: string) => updateAsset(slug, asset.id, { status: 'awaiting-manual', error });

  try {
    const provider = providerName ? videoProvider(providerName) : null;
    if (provider && !ctx.up.has(provider.name)) ctx.up.set(provider.name, await provider.available());
    if (!provider || !ctx.up.get(provider.name)) {
      await stall(providerName ? `${providerName}: ${NO_PROVIDER}` : NO_PROVIDER);
      return;
    }

    // Both renderers are driven by this beat's own slice of the voiceover: it is
    // what the presenter speaks, and it is what sets a page's screen time.
    const audioPath = beatAudioFile(slug, req.beatId);
    const hasAudio = await fs.stat(audioPath).then(() => true).catch(() => false);
    if (!hasAudio) {
      await stall('No audio for this beat — add the voiceover and align it first.');
      return;
    }

    const shared = { audioPath, brief: req.brief, seconds: req.seconds, seed: reel.seed, ratio: reel.ratio };

    if (providerName === 'webpage') {
      const link = ctx.script ? resolveLink(ctx.script, ctx.candidates, req.sourceLineId) : null;
      if (!link) {
        await stall('No source to show for this beat — its line cites nothing, so there is no page to visit.');
        return;
      }
      const { jobId } = await provider.animate({ ...shared, url: link.url, highlight: link.highlight });
      await updateAsset(slug, asset.id, { status: 'running', jobId, provider: provider.name });
      return;
    }

    if (!ctx.presenterImage) {
      await stall('No presenter image is set — choose one in settings before rendering a talking head.');
      return;
    }
    const { jobId } = await provider.animate({ ...shared, imagePath: ctx.presenterImage });
    await updateAsset(slug, asset.id, { status: 'running', jobId, provider: provider.name });
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
  // Only when nothing can render the beat. A page shot is generated now, and
  // promoting a leftover screenshot here silently undid every retry.
  if (videoProvider(providerNameFor('screen') ?? '')) return reel;
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
  const ctx = await buildContext(slug);
  for (const req of planShots(reel, pattern.pacing.shotSec)) {
    await generateOne(slug, req, await loadReel(slug), ctx);
  }
  return loadReel(slug);
}

/** Moves running provider jobs forward; called by the studio while it polls. */
export async function refreshShots(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  for (const asset of reel.assets) {
    if (asset.status !== 'running' || !asset.jobId) continue;
    // Each asset records the renderer that made it, so a reel with both kinds of
    // shot polls two machines without either knowing about the other.
    const provider = asset.provider ? videoProvider(asset.provider) : null;
    if (!provider) continue;

    // A reel polls two machines. One of them being unreachable must not cost the
    // finished clips of the other, so a provider that throws is skipped and
    // asked again on the next poll rather than failing the sweep.
    let state: Awaited<ReturnType<typeof provider.jobState>>;
    try {
      state = await provider.jobState(asset.jobId);
    } catch {
      continue;
    }

    // The renderer answered, and does not have this job. Asking again for ever
    // leaves the asset running, so the reel could never report itself stuck and
    // nothing would re-queue the beat.
    if (state === 'gone') {
      await updateAsset(slug, asset.id, {
        status: 'failed',
        error: `${provider.name} no longer knows job ${asset.jobId}`,
      });
      continue;
    }
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
