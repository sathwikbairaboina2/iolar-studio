import { promises as fs } from 'fs';
import path from 'path';
import { Beat, REEL_RATIOS, Reel } from './schema';
import { addAsset, loadReel, saveReel, updateAsset } from './store';
import { beatSpans } from './assemble';
import { loadPattern } from './patterns';
import { reelAssetsDir, reelVoFile } from '../paths';
import { ffprobeMedia } from './probe';
import { NO_PROVIDER, providerNameFor, videoProvider } from './videoProvider';
import { resolveLink } from './build/links';
import { beatAudioFile, groupAudioFile, sliceSpan } from './build/audio';
import { groupAdjacent } from './shotmix';
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

/**
 * The one render a wholly spoken reel needs.
 *
 * Null when the reel has no aligned voiceover to speak, or when any beat wants a page shot:
 * that is a different renderer and a different picture, and cutting to it out of one take is
 * the studio's job, not the renderer's.
 */
export function planTake(reel: Reel, slug: string): { kind: Beat['shot']['kind']; seconds: number; audioPath: string } | null {
  if (!reel.vo.durationSec || !reel.vo.words.length) return null;
  const spoken = reel.beats.filter((b) => b.shot.kind !== 'title');
  if (!spoken.length || spoken.some((b) => b.shot.kind !== 'talking-head')) return null;
  return { kind: 'talking-head', seconds: reel.vo.durationSec, audioPath: reelVoFile(slug) };
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
  /** What the renderers will be asked for, so the gate shows the real numbers. */
  fps: number;
  steps: number;
  /** Asked once per run: a renderer busy with beat one is not missing for beat six. */
  up: Map<string, boolean>;
};

async function buildContext(slug: string, reel: Reel): Promise<BuildContext> {
  const settings = getSettings();
  const presenterImage = settings.presenterImage;
  // 0 means "follow the reel", which is the setting that avoids resampling.
  const fps = settings.lipsyncFps || reel.fps;
  const steps = settings.lipsyncSteps;
  // A reel planned from a topic has no research behind it, and a pack that fails
  // to load is not the same failure as a script that does — reporting "its line
  // cites nothing" for a corrupt candidates file sends you looking in the wrong
  // place.
  const script = await research.readScript(slug).catch(() => null);
  const pack = await research.readCandidates(slug).catch(() => null);
  return { script, candidates: pack?.candidates ?? [], presenterImage, fps, steps, up: new Map() };
}

/** What a renderer would be handed for one beat, or the reason it cannot be. */
export type ResolvedShot = {
  beatId: string;
  /** Every beat this one request covers. A run over one page is one recording of it. */
  beatIds?: string[];
  kind: Beat['shot']['kind'];
  provider: string | null;
  brief: string;
  seconds: number;
  hero: boolean;
  audioPath: string;
  url?: string;
  highlight?: string;
  imagePath?: string;
  blocked: string | null;
  /** Exactly what would be posted to the renderer, for the gate to show before it is. */
  payload?: Record<string, unknown>;
};

/**
 * Works out the whole request without sending it.
 *
 * Dispatch and preview read the same function, so what the gate shows is what the renderer
 * gets — a preview assembled separately would drift from the call it describes and stop
 * being worth looking at.
 */
export async function resolveShot(
  slug: string,
  req: ShotRequest,
  reel: Reel,
  ctx: BuildContext,
  /** The audio this request is spoken over, when it covers more than its own beat. */
  spanAudio?: string,
  /**
   * What to check for when asking whether this beat has audio at all.
   *
   * A request covering several beats is spoken over a stretch cut at run time, so the file
   * named in the payload does not exist while the gate is only being looked at. Judging the
   * request by it reported every such row as having no audio; the beats it covers are the
   * honest test.
   */
  audioProbe?: string
): Promise<ResolvedShot> {
  const providerName = providerNameFor(req.kind);
  const audioPath = spanAudio ?? (req.beatId === '*' ? reelVoFile(slug) : beatAudioFile(slug, req.beatId));
  const probePath = audioProbe ?? audioPath;
  const base: ResolvedShot = {
    beatId: req.beatId,
    kind: req.kind,
    provider: providerName,
    brief: req.brief,
    seconds: req.seconds,
    hero: req.hero,
    audioPath,
    blocked: null,
  };

  const provider = providerName ? videoProvider(providerName) : null;
  if (provider && !ctx.up.has(provider.name)) ctx.up.set(provider.name, await provider.available());
  if (!provider || !ctx.up.get(provider.name)) {
    return { ...base, blocked: providerName ? `${providerName}: ${NO_PROVIDER}` : NO_PROVIDER };
  }

  // Both renderers are driven by this beat's own slice of the voiceover: it is
  // what the presenter speaks, and it is what sets a page's screen time.
  const hasAudio = await fs.stat(probePath).then(() => true).catch(() => false);
  if (!hasAudio) {
    return { ...base, blocked: 'No audio for this beat — add the voiceover and align it first.' };
  }

  if (providerName === 'webpage') {
    const link = ctx.script ? resolveLink(ctx.script, ctx.candidates, req.sourceLineId) : null;
    if (!link) {
      return {
        ...base,
        blocked: 'No source to show for this beat — its line cites nothing, so there is no page to visit.',
      };
    }
    return {
      ...base,
      url: link.url,
      highlight: link.highlight,
      payload: { url: link.url, ...(link.highlight ? { highlight: link.highlight } : {}), audio: audioPath },
    };
  }

  if (!ctx.presenterImage) {
    return { ...base, blocked: 'No presenter image is set — choose one in settings before rendering a talking head.' };
  }
  return {
    ...base,
    imagePath: ctx.presenterImage,
    payload: {
      image_path: ctx.presenterImage,
      audio_path: audioPath,
      preset: reel.ratio === '9:16' ? 'portrait' : 'square',
    },
  };
}

/**
 * The reel as a list of requests, with neighbours that show the same thing collapsed.
 *
 * A beat is not a render. Four lines spoken over one document is one recording of that
 * document; three presenter lines in a row is one bite. What separates two requests is a
 * change of picture, not a change of sentence.
 */
export async function planGroups(slug: string, reel: Reel, ctx: BuildContext, shotSec: [number, number]) {
  const spans = beatSpans(reel);
  const reqs = planShots(reel, shotSec);
  const segments: { beatId: string; key: string; seconds: number }[] = [];
  const keyed = new Map<string, ShotRequest>();

  for (const req of reqs) {
    const span = spans.get(req.beatId);
    const seconds = span ? span.end - span.start : req.seconds;
    let key = 'presenter';
    if (providerNameFor(req.kind) === 'webpage') {
      const link = ctx.script ? resolveLink(ctx.script, ctx.candidates, req.sourceLineId) : null;
      key = link ? `page:${link.url}` : `page:none:${req.beatId}`;
    }
    segments.push({ beatId: req.beatId, key, seconds });
    keyed.set(req.beatId, req);
  }

  return groupAdjacent(segments).map((g) => ({ ...g, first: keyed.get(g.beatIds[0])! }));
}

/**
 * Every request this reel would send, as it would be sent.
 *
 * Read-only on purpose: a look at the queue must not create the assets it describes, or
 * opening the gate would itself be the thing that commits the spend.
 */
export async function previewShots(slug: string): Promise<ResolvedShot[]> {
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const ctx = await buildContext(slug, reel);

  const out: ResolvedShot[] = [];
  for (const g of await planGroups(slug, reel, ctx, pattern.pacing.shotSec)) {
    const req = { ...g.first, seconds: g.seconds };
    const audio =
      g.beatIds.length === 1 ? beatAudioFile(slug, g.beatIds[0]) : groupAudioFile(slug, `${g.key}-${g.startsAt}`);
    const shot = await resolveShot(slug, req, reel, ctx, audio, beatAudioFile(slug, g.beatIds[0]));
    out.push({ ...shot, beatIds: g.beatIds });
  }
  return out;
}

/** The whole reel as one shot request. `*` is the take rather than any one beat. */
const TAKE_REQUEST = (take: { seconds: number }): ShotRequest => ({
  beatId: '*',
  kind: 'talking-head',
  brief: 'the whole voiceover, in one take',
  hero: true,
  seconds: take.seconds,
  sourceLineId: null,
});

/** A stable per-beat seed: same reel and beat, same take; different beat, different take. */
export function seedForBeat(reelSeed: number, beatId: string): number {
  let h = 2166136261 ^ reelSeed;
  for (let i = 0; i < beatId.length; i++) {
    h ^= beatId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}

/**
 * Renders one picture and hands it to every beat spoken over it.
 *
 * `takeStart` is where this footage begins on the reel's clock, so the timeline can cut
 * inside it: a clip at 12s of a visit that started at 9s shows second three of the
 * recording, not the top of it again.
 */
async function generateGroup(
  slug: string,
  req: ShotRequest,
  beatIds: string[],
  startsAt: number,
  audio: string,
  reel: Reel,
  ctx: BuildContext
): Promise<void> {
  const [width, height] = REEL_RATIOS[reel.ratio];
  const providerName = providerNameFor(req.kind);
  const asset = await addAsset(slug, {
    kind: 'video',
    path: '',
    origin: 'plugin',
    status: 'queued',
    brief: req.brief,
    provider: providerName ?? undefined,
    takeStart: startsAt,
    width,
    height,
  });
  for (const id of beatIds) await pointBeatAt(slug, id, asset.id);

  const stall = (error: string) => updateAsset(slug, asset.id, { status: 'awaiting-manual', error });

  try {
    const plan = await resolveShot(slug, req, reel, ctx, audio);
    if (plan.blocked) {
      await stall(plan.blocked);
      return;
    }
    const provider = videoProvider(plan.provider!)!;
    const shared = { audioPath: plan.audioPath, brief: plan.brief, seconds: plan.seconds, seed: reel.seed, ratio: reel.ratio, fps: reel.fps };
    const { jobId } = await provider.animate(
      plan.url ? { ...shared, url: plan.url, highlight: plan.highlight } : { ...shared, imagePath: plan.imagePath! }
    );
    await updateAsset(slug, asset.id, { status: 'running', jobId, provider: provider.name });
  } catch (err) {
    await updateAsset(slug, asset.id, { status: 'failed', error: String(err).slice(0, 300) });
  }
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
    const plan = await resolveShot(slug, req, reel, ctx);
    if (plan.blocked) {
      await stall(plan.blocked);
      return;
    }

    const provider = videoProvider(plan.provider!)!;
    const shared = {
      audioPath: plan.audioPath,
      brief: plan.brief,
      seconds: plan.seconds,
      // One seed for the whole reel gave every beat the same performance: the same tilt of
      // the head, the same hands, thirteen times over. The beat is folded in so each shot
      // is its own take while the reel as a whole stays reproducible.
      seed: seedForBeat(reel.seed, req.beatId),
      ratio: reel.ratio,
      fps: ctx.fps,
      steps: ctx.steps,
    };
    const { jobId } = await provider.animate(
      plan.url ? { ...shared, url: plan.url, highlight: plan.highlight } : { ...shared, imagePath: plan.imagePath! }
    );
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
/**
 * Queues the plan, or the part of it that was approved.
 *
 * `beatIds` is what came back through the gate: an empty list means a human looked and chose
 * none, which is not the same as never having been asked, so it queues nothing.
 */
export async function runTake(slug: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const take = planTake(reel, slug);
  if (!take) throw new Error('this reel is not one continuous take — some beats want another renderer');

  const ctx = await buildContext(slug, reel);
  const plan = await resolveShot(slug, TAKE_REQUEST(take), reel, ctx);
  if (plan.blocked) throw new Error(plan.blocked);

  const [width, height] = REEL_RATIOS[reel.ratio];
  const asset = await addAsset(slug, {
    kind: 'video',
    path: '',
    origin: 'plugin',
    status: 'queued',
    brief: 'the whole voiceover, in one take',
    provider: plan.provider ?? undefined,
    fullTake: true,
    width,
    height,
  });

  try {
    const provider = videoProvider(plan.provider!)!;
    const { jobId } = await provider.animate({
      audioPath: plan.audioPath,
      brief: plan.brief,
      seconds: plan.seconds,
      seed: reel.seed,
      ratio: reel.ratio,
      fps: reel.fps,
      imagePath: plan.imagePath!,
    });
    await updateAsset(slug, asset.id, { status: 'running', jobId, provider: provider.name });
  } catch (err) {
    await updateAsset(slug, asset.id, { status: 'failed', error: String(err).slice(0, 300) });
  }

  // Every spoken beat is cut from it.
  const current = await loadReel(slug);
  await saveReel(slug, {
    ...current,
    beats: current.beats.map((b) =>
      b.shot.kind === 'title' ? b : { ...b, shot: { ...b.shot, assetId: asset.id } }
    ),
  });
  return loadReel(slug);
}

export async function runShots(slug: string, beatIds?: string[]): Promise<Reel> {
  await useStillsForScreens(slug);
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const ctx = await buildContext(slug, reel);
  const wanted = beatIds ? new Set(beatIds) : null;

  for (const g of await planGroups(slug, reel, ctx, pattern.pacing.shotSec)) {
    if (wanted && !g.beatIds.some((id) => wanted.has(id))) continue;
    // One stretch of voiceover per request, cut before it is sent: the renderer is told
    // what this picture is spoken over, not what one sentence inside it is.
    // A group of one is already cut: its beat's own audio is that stretch. Only a run of
    // beats needs a fresh cut spanning them.
    const audio =
      g.beatIds.length === 1
        ? beatAudioFile(slug, g.beatIds[0])
        : await sliceSpan(slug, `${g.key}-${g.startsAt}`, g.startsAt, g.startsAt + g.seconds);
    await generateGroup(slug, { ...g.first, seconds: g.seconds }, g.beatIds, g.startsAt, audio, await loadReel(slug), ctx);
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
  // One beat was asked for, so one beat is queued: a retry that swept up every other
  // pending shot spent an hour of GPU nobody had approved.
  return runShots(slug, [beatId]);
}

/**
 * Changes what kind of shot a beat is, and lets go of whatever was made for it.
 *
 * The way out of a beat that can never be rendered as planned — a page shot whose line cites
 * nothing, a talking head with no presenter. It queues nothing: the recast beat goes back
 * into the plan and through the gate like any other.
 */
export async function recastShot(slug: string, beatId: string, kind: Beat['shot']['kind']): Promise<Reel> {
  if (!GENERATABLE.includes(kind)) {
    throw new Error(`no renderer makes a ${kind} shot — pick ${GENERATABLE.join(' or ')}`);
  }
  const reel = await loadReel(slug);
  const beat = reel.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`no beat ${beatId}`);
  await saveReel(slug, {
    ...reel,
    beats: reel.beats.map((b) => (b.id === beatId ? { ...b, shot: { ...b.shot, kind, assetId: undefined } } : b)),
  });
  return loadReel(slug);
}

/**
 * Stops waiting on a job and hands the beat to a human.
 *
 * A renderer that restarted has forgotten its queue, and the studio would otherwise poll a
 * job id nobody will ever answer for. The asset stays attached so the drop target for your
 * own file stays where it was.
 */
export async function abandonShot(slug: string, beatId: string, why: string): Promise<Reel> {
  const reel = await loadReel(slug);
  const beat = reel.beats.find((b) => b.id === beatId);
  const asset = beat?.shot.assetId ? reel.assets.find((a) => a.id === beat.shot.assetId) : undefined;
  if (!asset) throw new Error(`beat ${beatId} has no shot to abandon`);
  if (asset.status === 'ready') throw new Error(`beat ${beatId} already has a ready shot`);
  await updateAsset(slug, asset.id, { status: 'awaiting-manual', error: why.slice(0, 300) });
  return loadReel(slug);
}
