import { promises as fs } from 'fs';
import path from 'path';
import { runClaude } from '../claude';
import { extractJson } from '../revise';
import { Pattern, loadPattern } from '../../reel/patterns';
import { loadReel, saveReel } from '../../reel/store';
import { Beat, Reel, ShotKind } from '../../reel/schema';
import { reelRefsDir } from '../../paths';
import { transcribe } from '../../reel/align';

export type PlanMode = 'topic' | 'paste' | 'reference';
export type PlanOut = { title: string; beats: Beat[]; caption: { text: string; hashtags: string[] } };

const SHAPE = `Return ONLY JSON (no prose, no markdown fences):
{
  "title": string,
  "beats": [ { "id": "b1", "role": "hook"|"body"|"close", "text": string,
               "shot": { "kind": "title"|"talking-head"|"screen"|"broll", "brief": string, "hero": boolean } } ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Rules:
- exactly one "hook" beat first, exactly one "close" beat last, "body" in between
- "text" is spoken word for word by the voiceover: no stage directions, no emoji, no markdown, no numbers written as digits where a narrator would say words
- "brief" describes the footage for that beat in one concrete line — what is on screen, and how it moves
- "hero": true on at most two beats, the shots worth a premium generation
- ids are b1, b2, b3 ... in order`;

export type PlanOpts = {
  /**
   * Shot kinds the planner may use.
   *
   * A researched reel is rendered entirely by two plugins — pages and lipsync —
   * and neither makes generic b-roll. Narrowing the palette here is what lets
   * every beat find a renderer, so the reel finishes without a human dropping
   * files in.
   */
  kinds?: readonly ShotKind[];
};

export function beatsPrompt(pattern: Pattern, mode: PlanMode, source: string, opts: PlanOpts = {}): string {
  const [lo, hi] = pattern.pacing.shotSec;
  const voice = `Write in the voice of ${pattern.displayName}: direct, fast, second person, present tense, no throat-clearing.`;
  const pacing =
    `Each beat is one shot lasting ${lo}-${hi} seconds when spoken aloud — roughly ${Math.round(lo * 2.6)}-${Math.round(hi * 2.6)} words. ` +
    `Never split a sentence across two beats: a beat ends where a sentence ends. ` +
    `Open with a hook of about ${pattern.hook.durationSec} seconds. Aim for 8-14 beats in total.`;
  const mix =
    `Shot mix target: about ${Math.round(pattern.shotMix.screen * 100)}% screen recordings, ` +
    `${Math.round(pattern.shotMix.talkingHead * 100)}% talking head, ${Math.round(pattern.shotMix.broll * 100)}% b-roll. ` +
    `Come back to a talking-head beat roughly every ${pattern.shotMix.anchorEverySec} seconds.`;

  const task =
    mode === 'paste'
      ? `Split this finished script into beats. Do not rewrite, reorder, shorten or improve a single word — the beat texts joined by spaces must equal the script exactly. Only add the shot briefs.\n\nSCRIPT:\n${source}`
      : mode === 'reference'
        ? `Below is the transcript of someone else's reel. Write a COMPLETELY FRESH original script on the same story with a similar arc. Never copy their phrasing.\n\nTRANSCRIPT:\n${source}`
        : `Write a short-form vertical video script about this.\n\nTOPIC:\n${source}`;

  const palette = opts.kinds?.length
    ? `Use ONLY these shot kinds: ${opts.kinds.join(', ')}. Any other kind is invalid, b-roll included.`
    : '';

  return [task, voice, pacing, mix, palette, SHAPE].filter(Boolean).join('\n\n');
}

/** Whitespace-insensitive comparison; everything else must match exactly. */
export function normaliseScript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Paste mode promises the script comes back word for word — that is the whole reason to
 * paste one rather than describe it. Nothing enforced that, and a re-split duplicated a
 * clause across two beats without failing anything.
 */
export function wordingDrift(script: string, beats: Beat[]): string | null {
  const want = normaliseScript(script);
  const got = normaliseScript(beats.map((b) => b.text).join(' '));
  if (want === got) return null;
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i += 1;
  return `the beats stop matching the script around "${got.slice(Math.max(0, i - 40), i + 40)}"`;
}

export function parseBeats(raw: string): PlanOut {
  const data = extractJson(raw) as Partial<PlanOut>;
  const beats = (data.beats ?? []).map((b, i) => ({
    id: b.id || `b${i + 1}`,
    role: b.role,
    text: String(b.text ?? '').trim(),
    shot: {
      kind: b.shot?.kind ?? 'broll',
      brief: String(b.shot?.brief ?? '').trim() || 'establishing shot for this line',
      hero: Boolean(b.shot?.hero),
      alsoAssetIds: [],
      // The bridge fills this in from the script's line offsets; a plan made
      // from a topic has no line to point at.
      sourceLineId: null,
    },
  })) as Beat[];
  if (!beats.length) throw new Error('plan returned no beats');
  if (beats.some((b) => !b.text)) throw new Error('plan returned a beat with no spoken text');
  const ids = new Set(beats.map((b) => b.id));
  if (ids.size !== beats.length) throw new Error('plan returned duplicate beat ids');
  return {
    title: String(data.title ?? '').trim() || 'Untitled reel',
    beats,
    caption: { text: data.caption?.text ?? '', hashtags: data.caption?.hashtags ?? [] },
  };
}

async function applyPlan(slug: string, out: PlanOut): Promise<Reel> {
  const reel = await loadReel(slug);
  const next: Reel = { ...reel, title: out.title, beats: out.beats, caption: out.caption };
  await saveReel(slug, next);
  return next;
}

function checked(mode: PlanMode, source: string, out: PlanOut): PlanOut {
  if (mode !== 'paste') return out;
  const drift = wordingDrift(source, out.beats);
  if (drift) throw new Error(`the script must come back word for word, but ${drift}`);
  return out;
}

async function generate(slug: string, mode: PlanMode, source: string, opts: PlanOpts = {}): Promise<Reel> {
  if (!source.trim()) throw new Error(`plan mode "${mode}" needs a source`);
  const reel = await loadReel(slug);
  const pattern = await loadPattern(reel.pattern);
  const prompt = beatsPrompt(pattern, mode, source, opts);
  const first = await runClaude(prompt, { timeoutMs: 900_000 });
  try {
    return await applyPlan(slug, checked(mode, source, parseBeats(first)));
  } catch (err) {
    const retry = await runClaude(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 400)}. Return corrected JSON only.`,
      { timeoutMs: 900_000 }
    );
    return applyPlan(slug, checked(mode, source, parseBeats(retry)));
  }
}

export function planFromTopic(slug: string, topic: string) {
  return generate(slug, 'topic', topic);
}

export function planFromScript(slug: string, script: string, opts: PlanOpts = {}) {
  return generate(slug, 'paste', script, opts);
}

/** Downloads the reference, transcribes it, then writes a fresh script on the same story. */
export async function planFromReference(slug: string, mediaUrl: string): Promise<Reel> {
  const dir = reelRefsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'reference.mp4');
  const r = await fetch(mediaUrl);
  if (!r.ok) throw new Error(`reference fetch ${mediaUrl} -> ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  const { text } = await transcribe(dest);
  await fs.writeFile(path.join(dir, 'transcript.txt'), text);
  return generate(slug, 'reference', text);
}
