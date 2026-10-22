import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { Proc } from '@/lib/explainer2/commands';
import type { VideoProvider } from '@/lib/reel/videoProvider';
import { launchAssetsDir, launchVoiceDir } from '@/lib/paths';
import { readAnchor } from './anchor';
import { makeAvatarClips } from './avatar';
import { layoutScenes, type EditInput } from './edit';
import { HfUnreachable, type Hf } from './higgsfield';
import type { Asset, Assets, Brief, Timing } from './schema';
import { readSpend, withBudget } from './spend';
import { readAssets, writeAssets } from './store';

/**
 * The assets stage beyond the receipts: avatar clips, b-roll photos, demo clips and post cards. Each is keyed by what it
 * was made from, so a finished asset is not made (or paid for) again, and recorded in assets.json with where it came from.
 */

export type AssetDeps = {
  /** The Higgsfield bridge, made only when something needs it. Without it Higgsfield counts as not reachable. */
  hf?: () => Promise<Hf>;
  lipsync: VideoProvider | null;
  http: typeof fetch;
  proc: Proc;
  sleep?: (ms: number) => Promise<unknown>;
};

export const CREATOR_BROLL_STYLE = " Cinematic, young Indian tech creator's world, practical light (tungsten lamp, fairy lights, monitor or phone glow), shot on 35mm, shallow depth of field, natural clutter, no readable text, no logos, no faces visible.";
const MOTION_SUFFIX = ' Photoreal, consistent objects, no cuts, no new text.';
const DEFAULT_MOTION = 'Slow push-in on the scene with a small natural movement of the main subject.';
const CLIP_SECONDS = 3;
const MAX_DEMO_SECONDS = 8;
const UNREACHABLE = 'Higgsfield is not reachable from the studio';

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));

/** The card text out of a publish.twitter.com oEmbed answer: the post's words, its author, @handle and date. */
export function parseOembed(json: { author_name?: unknown; author_url?: unknown; html?: unknown }): { author: string; handle: string; date: string; text: string } | null {
  const html = typeof json.html === 'string' ? json.html : '';
  const body = html.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
  const text = decode(body.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/https?:\/\/\S+/g, '').replace(/\bpic\.(twitter|x)\.com\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const after = html.slice(html.indexOf('</p>') + 4);
  const date = decode(after.match(/<a [^>]*>([^<]+)<\/a>\s*(?:<\/blockquote>)?\s*$/)?.[1] ?? '').trim();
  const author = typeof json.author_name === 'string' ? decode(json.author_name).trim() : '';
  const name = typeof json.author_url === 'string' ? json.author_url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() : '';
  if (!text || !author) return null;
  return { author, handle: name ? `@${name}` : '', date, text };
}

const hashFiles = async (files: string[]) => {
  const h = createHash('sha1');
  for (const f of files) h.update(await fs.readFile(f).catch(() => ''));
  return h.digest('hex').slice(0, 8);
};

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Deletes one asset's files and entry, so the next run of the stage makes it again. */
export async function dropAsset(slug: string, id: string): Promise<boolean> {
  const assets = await readAssets(slug);
  const a = assets?.assets[id];
  if (!assets || !a) return false;
  const dir = launchAssetsDir(slug);
  const base = id.startsWith('broll-') ? [a.file, `${id}.png`, `${id}.mp4`] : id.startsWith('avatar-') ? [a.file, `${id}.mp3`, ...(await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.startsWith(`${id}-`))] : [a.file];
  for (const f of base) if (f) await fs.rm(path.join(dir, f), { force: true });
  delete assets.assets[id];
  await writeAssets(slug, assets);
  return true;
}

export async function makeAssets(slug: string, input: EditInput, brief: Brief, timing: Timing, deps: AssetDeps): Promise<Assets> {
  const dir = launchAssetsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const prior = (await readAssets(slug)) ?? { assets: {}, notes: [] };
  const out: Assets = { assets: {}, notes: [] };
  const { frames } = layoutScenes(timing, input.scenes);
  const note = (n: string) => { if (!out.notes.includes(n)) out.notes.push(n); };

  /** A finished asset of the same key is kept; a refused one, or a fallback (still portrait, swapped b-roll), is tried again. */
  const reuse = async (id: string, key: string): Promise<boolean> => {
    const a = prior.assets[id];
    if (!a || a.key !== key || a.source === 'refused' || a.source === 'still' || a.source === 'swapped') return false;
    if (a.file && !(await exists(path.join(dir, a.file)))) return false;
    out.assets[id] = a;
    return true;
  };

  let hfCache: Promise<Hf> | null = null;
  const getHf = (): Promise<Hf> => (hfCache ??= deps.hf ? deps.hf() : Promise.reject(new HfUnreachable()));
  const whyNot = async (): Promise<string> => {
    const last = (await readSpend(slug))?.entries.at(-1);
    if (last?.outcome === 'skipped-over-budget') return 'it would take the reel over its credit budget';
    if (last?.outcome === 'unknown') return 'the request was sent but its outcome is not known, so it was not retried';
    return 'Higgsfield did not make it';
  };

  // Avatar clips: one call for all of them, so their parts are submitted together and waited on together.
  const avatarScenes = input.scenes.flatMap((s, i) => (s.type === 'AvatarTalk' ? [{ s, i }] : []));
  const toMake: { id: string; from: number; to: number; layout: 'columnist' | 'photo' | 'split'; key: string }[] = [];
  for (const { s, i } of avatarScenes) {
    const { from, to } = frames[i];
    const beats = timing.beats.filter((b) => b.start < to && b.start + (b.voice ?? b.end - b.start) > from);
    const key = `${from}-${to}-${s.layout}-${await hashFiles(beats.map((b) => path.join(launchVoiceDir(slug), `${b.id}.mp3`)))}`;
    if (!(await reuse(`avatar-${i}`, key))) toMake.push({ id: String(i), from, to, layout: s.layout, key });
  }
  if (toMake.length) {
    const anchor = await readAnchor();
    if (!anchor) throw new Error('no anchor is locked; open the Anchor page and pick a face');
    const clips = await makeAvatarClips(slug, toMake, { hf: new LazyHf(getHf), lipsync: deps.lipsync, anchor, timing, proc: deps.proc, http: deps.http, note, sleep: deps.sleep });
    for (const m of toMake) {
      const c = clips[m.id];
      out.assets[`avatar-${m.id}`] = { kind: 'avatar', source: c.source, file: c.file, key: m.key, ...(c.source === 'still' ? { reason: 'no clip could be made; the reel shows the portrait' } : {}) };
    }
  }

  // B-roll: a still per scene, then a short moving clip made from that still. The still is the fallback for a failed clip.
  const brolls: { id: string; prompt: string; motion: string; job: string | null; clipJob: string | null; key: string }[] = [];
  for (const [i, s] of input.scenes.entries()) {
    if (s.type !== 'BRoll') continue;
    const id = `broll-${i}`;
    const motion = (s.motion?.trim() || DEFAULT_MOTION) + MOTION_SUFFIX;
    const key = `${s.prompt}|${motion}`;
    if (await reuse(id, key)) continue;
    brolls.push({ id, prompt: s.prompt, motion, job: null, clipJob: null, key });
  }
  if (brolls.length) {
    let reachable = true;
    let unreachable = UNREACHABLE;
    const fetchTo = async (url: string, file: string) => {
      const res = await deps.http(url);
      if (!res.ok) throw new Error(String(res.status));
      await fs.writeFile(path.join(dir, file), new Uint8Array(await res.arrayBuffer()));
    };
    try {
      const hf = await getHf();
      for (const b of brolls) {
        const params = { kind: 'image', model: 'nano_banana_pro', aspect_ratio: '9:16', resolution: '1k', prompt: b.prompt + CREATOR_BROLL_STYLE };
        b.job = await withBudget(slug, hf, id2what(b.id), params, () => hf.generateImage(params));
      }
      const jobs = brolls.flatMap((b) => (b.job ? [b.job] : []));
      const done = jobs.length ? await hf.wait(jobs, 10 * 60_000) : {};
      const stills = new Set<string>();
      for (const b of brolls) {
        const r = b.job ? done[b.job] : undefined;
        if (r?.status === 'completed' && r.url) {
          try {
            await fetchTo(r.url, `${b.id}.png`);
            stills.add(b.id);
          } catch {
            // falls through to the swap
          }
        }
      }
      // Motion from each finished still, all submitted together and waited on once.
      for (const b of brolls) {
        if (!stills.has(b.id)) continue;
        const params = { kind: 'video', model: 'kling3_0', aspect_ratio: '9:16', duration: CLIP_SECONDS, mode: 'std', sound: 'off', medias: [{ role: 'start_image', value: b.job! }], prompt: b.motion };
        b.clipJob = await withBudget(slug, hf, `${id2what(b.id)} motion`, params, () => hf.generateVideo(params));
      }
      const clipJobs = brolls.flatMap((b) => (b.clipJob ? [b.clipJob] : []));
      const clips = clipJobs.length ? await hf.wait(clipJobs, 15 * 60_000) : {};
      for (const b of brolls) {
        if (!stills.has(b.id)) {
          out.assets[b.id] = { kind: 'broll', source: 'swapped', file: '', key: b.key, reason: b.job ? 'the photo could not be fetched' : await whyNot() };
          continue;
        }
        const c = b.clipJob ? clips[b.clipJob] : undefined;
        if (c?.status === 'completed' && c.url) {
          try {
            await fetchTo(c.url, `${b.id}.mp4`);
            const probe = await deps.proc('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, `${b.id}.mp4`)], { timeoutMs: 30_000 });
            const secs = probe.code === 0 ? Number.parseFloat(probe.output) : NaN;
            out.assets[b.id] = { kind: 'broll', source: 'higgsfield', file: `${b.id}.mp4`, key: b.key, seconds: secs > 0 ? Math.round(secs * 100) / 100 : CLIP_SECONDS };
            continue;
          } catch {
            // keeps the still
          }
        }
        out.assets[b.id] = { kind: 'broll', source: 'higgsfield', file: `${b.id}.png`, key: b.key };
      }
    } catch (err) {
      if (!(err instanceof HfUnreachable)) throw err;
      reachable = false;
      unreachable = err.message;
      note(unreachable);
    }
    if (!reachable) for (const b of brolls) out.assets[b.id] = { kind: 'broll', source: 'swapped', file: '', key: b.key, reason: unreachable };
  }

  // Demo clips: only links the user gave, video only, trimmed to the scene (at most 8 s) and silent.
  for (const [i, s] of input.scenes.entries()) {
    if (s.type !== 'DemoClip') continue;
    const demo = brief.demos.find((d) => d.id === s.clip);
    if (!demo) continue;
    const seconds = Math.min(MAX_DEMO_SECONDS, Math.round(((frames[i].to - frames[i].from) / timing.fps) * 100) / 100);
    const key = `${demo.url}|${seconds}`;
    if (await reuse(s.clip, key)) continue;
    out.assets[s.clip] = await fetchDemo(demo.url, s.clip, seconds, key, dir, deps);
  }

  // Post cards: the post's text from X's own embed service.
  for (const s of input.scenes) {
    if (s.type !== 'PostCard') continue;
    const post = brief.posts.find((p) => p.id === s.post);
    if (!post) continue;
    if (await reuse(s.post, post.url)) continue;
    out.assets[s.post] = await fetchPost(post.url, post.url, deps);
  }

  await writeAssets(slug, out);
  return out;
}

const id2what = (id: string) => `b-roll ${id}`;

async function fetchDemo(url: string, id: string, seconds: number, key: string, dir: string, deps: AssetDeps): Promise<Asset> {
  const refused = (reason: string): Asset => ({ kind: 'demo', source: 'refused', file: '', key, reason });
  try {
    const res = await deps.http(url);
    if (!res.ok) return refused(`the link answered ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!type.startsWith('video/')) return refused(`the link is not a video (it is ${type || 'unknown'})`);
    const raw = path.join(dir, `${id}.raw`);
    await fs.writeFile(raw, new Uint8Array(await res.arrayBuffer()));
    const file = `${id}.mp4`;
    const r = await deps.proc('ffmpeg', ['-y', '-i', raw, '-t', String(seconds), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, file)], { timeoutMs: 300_000 });
    await fs.rm(raw, { force: true });
    if (r.code !== 0) return refused('the video could not be read');
    // The frame on screen follows the clip's own aspect, so read it from the trimmed file.
    const probe = await deps.proc('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path.join(dir, file)], { timeoutMs: 30_000 });
    const m = probe.code === 0 ? /(\d+)x(\d+)/.exec(probe.output) : null;
    return { kind: 'demo', source: 'download', file, key, ...(m ? { width: Number(m[1]), height: Number(m[2]) } : {}) };
  } catch (err) {
    return refused(`the link could not be fetched (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`);
  }
}

async function fetchPost(url: string, key: string, deps: AssetDeps): Promise<Asset> {
  const refused = (reason: string): Asset => ({ kind: 'post', source: 'refused', file: '', key, reason });
  try {
    const res = await deps.http(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`);
    if (!res.ok) return refused(`X does not show that post (it answered ${res.status}); it may be deleted or private`);
    const post = parseOembed((await res.json()) as never);
    if (!post) return refused('X returned no text for that post');
    return { kind: 'post', source: 'oembed', file: '', key, post };
  } catch (err) {
    return refused(`the post could not be fetched (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`);
  }
}

/** Defers making the real bridge until a call needs it, so a reel with nothing to generate never touches it. */
class LazyHf implements Hf {
  constructor(private readonly get: () => Promise<Hf>) {}
  balance = async () => (await this.get()).balance();
  cost = async (p: object) => (await this.get()).cost(p);
  uploadFile = async (f: string, t: string) => (await this.get()).uploadFile(f, t);
  generateVideo = async (p: object) => (await this.get()).generateVideo(p);
  generateImage = async (p: object) => (await this.get()).generateImage(p);
  generateAudio = async (p: object) => (await this.get()).generateAudio(p);
  wait = async (ids: string[], ms: number) => (await this.get()).wait(ids, ms);
}
