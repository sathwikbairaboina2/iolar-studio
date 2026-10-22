import { promises as fs } from 'fs';
import path from 'path';
import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { launchInboxMediaDir } from '@/lib/paths';
import { readWatchState, writeReference, writeWatchState, type Reference, type WatchState } from './inbox';

/**
 * The daily watch: reads instascraper's API for the channels tracked there, asks the model once which new reels are
 * launches, downloads and analyses those, and files each as a reference in the inbox. It never copies a reference's words
 * or footage; only the topic and the pacing leave the inbox.
 */

const MIN_SHOT_SEC = 0.2; // as lib/reel/clone.ts
const FRESH_RUN_MS = 2 * 3_600_000;
const RETRY_AFTER_SKIP_MS = 30 * 60_000;
const RECENT_MS = 3 * 86_400_000;
const MAX_KIND_FRAMES = 12;

export type WatchDeps = {
  http: typeof fetch;
  base: string;
  run: ClaudeRun;
  transcribe: (file: string) => Promise<{ text: string }>;
  cuts: (file: string) => Promise<number[]>;
  duration: (file: string) => Promise<number>;
  /** One frame at each time, written under `outDir`; returns their paths in order. */
  frames: (file: string, at: number[], outDir: string) => Promise<string[]>;
  now: () => Date;
  maxDownloads?: number;
  /** How long to wait for instascraper to fetch the reels, and how often to ask. */
  waitMs?: number;
  pollMs?: number;
  /** How long to wait for instascraper to finish the syncs it was asked for before the posts are read. */
  syncWaitMs?: number;
};

export type WatchResult = { checked: number; launches: number; added: string[]; skipped: string | null };

type Item = { shortcode: string; kind?: string; is_video?: boolean; taken_at?: string; caption?: string | null; ig_url?: string | null };
type Candidate = { shortcode: string; creator: string; takenAt: string; caption: string; url: string };

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function shotsFromCuts(cuts: number[], durationSec: number): { start: number; end: number }[] {
  const marks = [0, ...cuts.filter((c) => c > 0 && c < durationSec), durationSec];
  const shots: { start: number; end: number }[] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    if (marks[i + 1] - marks[i] >= MIN_SHOT_SEC) shots.push({ start: marks[i], end: marks[i + 1] });
  }
  return shots;
}

const isFresh = (s: WatchState, now: Date) => s.running && s.lastRunAt !== null && now.getTime() - new Date(s.lastRunAt).getTime() < FRESH_RUN_MS;
let inFlight = false;

/** True while a run is going, in this process or (under 2 hours ago) another. */
export async function watchRunning(now: Date = new Date()): Promise<boolean> {
  return inFlight || isFresh(await readWatchState(), now);
}

async function getJson(deps: WatchDeps, p: string, init?: RequestInit): Promise<any> {
  const res = await deps.http(`${deps.base}${p}`, init);
  if (!res.ok) throw new Error(`${p} answered ${res.status}`);
  return res.json();
}

const CLASSIFY_SHAPE = '{ "reels": [ { "shortcode": string, "launch": boolean, "topic": string } ] }';

function classifyPrompt(cands: Candidate[]): string {
  return [
    'Which of these Instagram reels announce a launch? A launch is a new AI model, AI product, or major AI feature release announced in the last week.',
    'Judge by the caption only. Answer for every reel.',
    '',
    ...cands.map((c) => `- ${c.shortcode} (@${c.creator}): ${JSON.stringify(c.caption.slice(0, 400))}`),
    '',
    'Return ONLY a JSON object of this shape, with no prose and no markdown fences:',
    CLASSIFY_SHAPE,
    '"topic" is at most 60 characters and names the launch, e.g. "Gemini 4 launch"; empty when launch is false.',
  ].join('\n');
}

async function classify(deps: WatchDeps, cands: Candidate[]): Promise<Map<string, string>> {
  const said = await deps.run(classifyPrompt(cands), { model: 'sonnet', allowedTools: [], timeoutMs: 180_000 });
  const reels = (extractJson(said) as { reels?: unknown }).reels;
  if (!Array.isArray(reels)) throw new Error('the answer has no "reels" list');
  const out = new Map<string, string>();
  for (const r of reels as { shortcode?: unknown; launch?: unknown; topic?: unknown }[]) {
    if (r && r.launch === true && typeof r.shortcode === 'string' && cands.some((c) => c.shortcode === r.shortcode)) {
      out.set(r.shortcode, (typeof r.topic === 'string' && r.topic.trim() ? r.topic.trim() : 'Launch').slice(0, 60));
    }
  }
  return out;
}

type Status = 'ready' | 'failed' | 'quota' | 'unknown' | 'queued' | 'fetching' | 'none';

/** Asks instascraper to fetch the reels, then asks again every `pollMs` until each is ready, failed or capped. */
async function ensureAll(deps: WatchDeps, codes: string[]): Promise<Record<string, Status>> {
  const deadline = Date.now() + (deps.waitMs ?? 300_000);
  const post = (): Promise<{ statuses?: Record<string, Status> }> =>
    getJson(deps, '/media/ensure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shortcodes: codes }) });
  let statuses = (await post()).statuses ?? {};
  const pending = () => codes.some((c) => ['queued', 'fetching', 'none', undefined].includes(statuses[c]));
  while (pending() && Date.now() < deadline) {
    await sleep(deps.pollMs ?? 5000);
    statuses = (await post()).statuses ?? statuses;
  }
  return statuses;
}

async function labelShots(deps: WatchDeps, file: string, shots: { start: number; end: number }[], dir: string): Promise<Reference['shots']> {
  const unknown = shots.map((s) => ({ ...s, kind: 'unknown' as const }));
  const n = Math.min(shots.length, MAX_KIND_FRAMES);
  if (!n) return unknown;
  try {
    const paths = await deps.frames(file, shots.slice(0, n).map((s) => (s.start + s.end) / 2), dir);
    const said = await deps.run([
      'Each image is one shot of a short vertical video, in order. Classify every shot as "talk" (a person talking to camera), "screen" (a screen recording or app),',
      '"broll" (other footage or an image) or "text" (mostly text on a plain background). Read each image with the Read tool.',
      ...paths.map((p, i) => `${i + 1}. ${p}`),
      'Return ONLY a JSON object { "kinds": [ ... ] } with one entry per image, in order.',
    ].join('\n'), { model: 'sonnet', allowedTools: ['Read'], timeoutMs: 180_000 });
    const kinds = (extractJson(said) as { kinds?: unknown }).kinds;
    if (!Array.isArray(kinds)) return unknown;
    return unknown.map((s, i) => (i < n && ['talk', 'screen', 'broll', 'text'].includes(kinds[i] as string) ? { ...s, kind: kinds[i] as 'talk' } : s));
  } catch {
    return unknown;
  }
}

async function analyse(deps: WatchDeps, c: Candidate, topic: string): Promise<Reference> {
  const file = path.join(launchInboxMediaDir(), `${c.shortcode}.mp4`);
  const res = await deps.http(`${deps.base}/media/${c.shortcode}/full`);
  if (!res.ok) throw new Error(`download answered ${res.status}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  let note: string | undefined;
  const durationSec = await deps.duration(file);
  const plain = shotsFromCuts(await deps.cuts(file), durationSec);
  let transcript = '';
  try {
    transcript = (await deps.transcribe(file)).text.trim();
  } catch (e) {
    note = `no transcript: ${msg(e)}`;
  }
  const shots = await labelShots(deps, file, plain, path.join(launchInboxMediaDir(), `${c.shortcode}-frames`));
  return {
    id: c.shortcode, creator: c.creator, postedAt: c.takenAt, url: c.url, caption: c.caption, topic, transcript,
    ...(note ? { note } : {}), durationSec, shots, status: 'new', foundAt: deps.now().toISOString(),
  };
}

/** Waits until instascraper's job queue is empty, or `syncWaitMs` passes. An instascraper without /status is not waited on. */
async function drainQueue(deps: WatchDeps): Promise<void> {
  const until = Date.now() + (deps.syncWaitMs ?? 10 * 60_000);
  for (;;) {
    let depth: number;
    try {
      depth = Number((await getJson(deps, '/status')).queue_depth ?? 0);
    } catch {
      return;
    }
    if (!(depth > 0) || Date.now() >= until) return;
    await sleep(deps.pollMs ?? 5000);
  }
}

export async function runWatch(deps: WatchDeps): Promise<WatchResult> {
  const result: WatchResult = { checked: 0, launches: 0, added: [], skipped: null };
  const now = deps.now();
  let state = await readWatchState();
  if (inFlight || isFresh(state, now)) return result;
  inFlight = true;
  state = { ...state, running: true, lastRunAt: now.toISOString() };
  await writeWatchState(state);
  const seen = new Set(state.seen);
  let skipped: WatchState['skipped'] = null;
  const skip = (reason: string) => { skipped = { at: now.toISOString(), reason }; result.skipped = reason; };
  try {
    let usernames: string[];
    try {
      usernames = ((await getJson(deps, '/profiles')).items as { username: string }[]).map((p) => p.username);
    } catch {
      skip('instascraper is not reachable');
      return result;
    }
    // A sync only queues the fetch of a profile's newest posts; reading the list before the queue drains reads last week.
    for (const u of usernames) await deps.http(`${deps.base}/profiles/${u}/sync`, { method: 'POST' }).catch(() => undefined);
    await drainQueue(deps);
    const cands: Candidate[] = [];
    for (const u of usernames) {
      let items: Item[] = [];
      try {
        items = (await getJson(deps, `/profiles/${u}/media?limit=30`)).items ?? [];
      } catch (e) {
        console.error('[instastudio] launch watch: could not read', u, msg(e));
        continue;
      }
      for (const it of items) {
        if (!(it.kind === 'reel' || it.is_video) || !it.taken_at || !it.shortcode) continue;
        if (now.getTime() - new Date(it.taken_at).getTime() > RECENT_MS || seen.has(it.shortcode)) continue;
        if (cands.some((c) => c.shortcode === it.shortcode)) continue;
        cands.push({ shortcode: it.shortcode, creator: u, takenAt: it.taken_at, caption: it.caption ?? '', url: it.ig_url || `https://www.instagram.com/reel/${it.shortcode}/` });
      }
    }
    result.checked = cands.length;
    if (!cands.length) return result;

    let topics: Map<string, string>;
    try {
      topics = await classify(deps, cands);
    } catch (e) {
      // Not marked seen: a model that was unavailable today may answer tomorrow.
      skip(`could not tell which reels are launches: ${msg(e).slice(0, 120)}`);
      return result;
    }
    for (const c of cands) seen.add(c.shortcode);
    const launches = cands.filter((c) => topics.has(c.shortcode)).sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, deps.maxDownloads ?? 8);
    result.launches = launches.length;
    if (!launches.length) return result;

    let statuses: Record<string, Status>;
    try {
      statuses = await ensureAll(deps, launches.map((c) => c.shortcode));
    } catch (e) {
      skip(`instascraper could not fetch the reels: ${msg(e).slice(0, 120)}`);
      return result;
    }
    if (launches.some((c) => statuses[c.shortcode] === 'quota')) skip('instascraper reel download cap spent');
    for (const c of launches) {
      if (statuses[c.shortcode] !== 'ready') continue;
      try {
        await writeReference(await analyse(deps, c, topics.get(c.shortcode)!));
        result.added.push(c.shortcode);
      } catch (e) {
        console.error('[instastudio] launch watch: could not analyse', c.shortcode, msg(e));
      }
    }
    return result;
  } catch (e) {
    skip(msg(e).slice(0, 160));
    return result;
  } finally {
    inFlight = false;
    const done = deps.now();
    // An unreachable instascraper does not use up the day: the next start (or a look at the inbox) tries again.
    const unreachable = result.skipped === 'instascraper is not reachable';
    await writeWatchState({ seen: [...seen], lastRunAt: done.toISOString(), lastDay: unreachable ? state.lastDay : localDay(done), skipped, running: false });
  }
}

/** Starts a run in the background when today has not been checked and none is going. Returns whether it started. */
export async function maybeRunWatch(deps?: WatchDeps): Promise<boolean> {
  const d = deps ?? (await realWatchDeps());
  const now = d.now();
  const state = await readWatchState();
  if (state.lastDay === localDay(now) || inFlight || isFresh(state, now)) return false;
  // After a skip, wait before trying again so a page that is looked at often does not hammer a service that is down.
  if (state.skipped && state.lastRunAt && now.getTime() - new Date(state.lastRunAt).getTime() < RETRY_AFTER_SKIP_MS) return false;
  void runWatch(d).catch((e) => console.error('[instastudio] launch watch failed', e));
  return true;
}

export async function realWatchDeps(): Promise<WatchDeps> {
  const [{ runClaude }, { transcribe }, probe] = await Promise.all([import('@/lib/ai/claude'), import('@/lib/reel/align'), import('@/lib/reel/probe')]);
  return {
    http: fetch,
    base: process.env.INSTASCRAPER_URL ?? 'http://localhost:3000/api',
    run: runClaude,
    transcribe,
    cuts: (f) => probe.sceneCuts(f),
    duration: async (f) => (await probe.ffprobeMedia(f)).durationSec,
    frames: (f, at, dir) => probe.extractFrames(f, at, dir, 480),
    now: () => new Date(),
  };
}
