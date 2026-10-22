import { z } from 'zod';
import { extractJson } from '@/lib/ai/revise';
import type { ClaudeRun } from '@/lib/explainer2/script';
import { ARC, LOOKS, TimingSchema, type Assets, type Brief, type Claim, type Claims, type Look, type Script, type Timing } from './schema';

/**
 * The edit list. The model picks scenes from a fixed library and says which claims they show; the studio places them
 * on the timeline and looks up every number and screenshot itself, so the render props hold nothing the model typed
 * that a gate has not checked.
 */

const claimId = z.string().regex(/^c\d+$/);
// Up to 8 so a face cam can hold 80% of a beat against 2 s cutaways in the creator look.
const base = { beat: z.enum(ARC), weight: z.number().min(0.5).max(8).default(1) };

export const SceneInSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Headline'), ...base, kicker: z.string().trim().min(1).max(24), title: z.string().trim().min(1).max(48), dek: z.string().trim().max(90).optional(), facts: z.array(z.object({ label: z.string().trim().min(1).max(14), value: z.string().trim().min(1).max(12) })).max(3).optional() }),
  z.object({ type: z.literal('Receipt'), ...base, claim: claimId, caption: z.string().trim().max(40).optional() }),
  z.object({ type: z.literal('PullQuote'), ...base, claim: claimId }),
  z.object({ type: z.literal('DeltaCard'), ...base, label: z.string().trim().min(1).max(32), before: claimId, after: claimId, better: z.enum(['lower', 'higher']), word: z.string().trim().min(1).max(12), beforeLabel: z.string().trim().min(1).max(14).optional(), afterLabel: z.string().trim().min(1).max(14).optional() }),
  z.object({ type: z.literal('BenchmarkBars'), ...base, title: z.string().trim().min(1).max(40), items: z.array(z.object({ label: z.string().trim().min(1).max(20), claim: claimId, ours: z.boolean().default(false) })).min(2).max(4) }),
  z.object({ type: z.literal('EndCard'), ...base, line: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('AvatarTalk'), ...base, layout: z.enum(['columnist', 'photo', 'split']), over: claimId.optional(), quote: z.string().trim().min(1).max(60).optional() })
    .refine((s) => s.layout !== 'split' || s.over !== undefined, { message: 'a split AvatarTalk needs an "over" claim: its receipt fills the bottom of the frame', path: ['over'] }),
  z.object({ type: z.literal('BRoll'), ...base, prompt: z.string().trim().min(1).max(300), motion: z.string().trim().min(1).max(160).optional(), kicker: z.string().trim().min(1).max(24).optional(), title: z.string().trim().min(1).max(48).optional() }),
  z.object({ type: z.literal('DemoClip'), ...base, clip: z.enum(['demo-1', 'demo-2', 'demo-3']), credit: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal('PostCard'), ...base, post: z.enum(['post-1', 'post-2', 'post-3']) }),
]);
export type SceneIn = z.infer<typeof SceneInSchema>;
export const EditInputSchema = z.object({ scenes: z.array(SceneInSchema).min(1).max(24) });
export type EditInput = z.infer<typeof EditInputSchema>;

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof RectSchema>;

export const ReceiptShotSchema = z.object({
  claim: claimId, file: z.string(), width: z.number().int().positive(), height: z.number().int().positive(),
  /** One rectangle per line of the quote, in the png's pixels; null when the quote was not found on the page. */
  focus: z.array(RectSchema).min(1).nullable(),
  url: z.string(), host: z.string(),
  /** The quote the shot was taken for, so a changed quote is captured again. */
  quote: z.string().optional(),
});
export type ReceiptShot = z.infer<typeof ReceiptShotSchema>;

const span = { from: z.number().int().nonnegative(), to: z.number().int().positive() };
const Figure = z.object({ value: z.number(), unit: z.string() });
export const SceneSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Headline'), ...span, kicker: z.string(), title: z.string(), dek: z.string().optional(), facts: z.array(z.object({ label: z.string(), value: z.string() })).max(3).optional() }),
  z.object({ type: z.literal('Receipt'), ...span, image: z.string(), width: z.number(), height: z.number(), focus: z.array(RectSchema).min(1), source: z.string(), caption: z.string().optional() }),
  z.object({ type: z.literal('PullQuote'), ...span, quote: z.string(), source: z.string(), attribution: z.string().optional() }),
  z.object({ type: z.literal('DeltaCard'), ...span, label: z.string(), before: Figure, after: Figure, change: z.string(), source: z.string(), beforeLabel: z.string().optional(), afterLabel: z.string().optional() }),
  z.object({ type: z.literal('BenchmarkBars'), ...span, title: z.string(), unit: z.string(), items: z.array(z.object({ label: z.string(), value: z.number(), ours: z.boolean() })).min(2), source: z.string() }),
  z.object({ type: z.literal('EndCard'), ...span, line: z.string(), handle: z.string() }),
  z.object({
    type: z.literal('AvatarTalk'), ...span, layout: z.enum(['columnist', 'photo', 'split']),
    /** The anchor's clip, or null for the still portrait with a slow push-in. */
    video: z.string().nullable(), portrait: z.string(),
    receipt: z.object({ image: z.string(), width: z.number(), height: z.number(), focus: z.array(RectSchema).min(1), source: z.string() }).optional(),
    quote: z.string().optional(),
  }),
  z.object({ type: z.literal('BRoll'), ...span, image: z.string(), clipSeconds: z.number().optional(), kicker: z.string().optional(), title: z.string().optional() }),
  z.object({ type: z.literal('DemoClip'), ...span, video: z.string(), credit: z.string(), width: z.number().optional(), height: z.number().optional() }),
  z.object({ type: z.literal('PostCard'), ...span, author: z.string(), handle: z.string(), date: z.string(), text: z.string() }),
]);
export type Scene = z.infer<typeof SceneSchema>;

export const LaunchPropsSchema = z.object({
  slug: z.string(), fps: z.literal(30), width: z.literal(1080), height: z.literal(1920), totalFrames: z.number().int().positive(),
  /** The masthead date, e.g. "21.10.26". */
  date: z.string(), bed: z.string().nullable(), emphasis: z.array(z.string()),
  /** The look to render in; absent means the newsroom look. */
  look: z.enum(LOOKS).optional(),
  timing: TimingSchema, scenes: z.array(SceneSchema).min(1),
});
export type LaunchProps = z.infer<typeof LaunchPropsSchema>;

/** A cut moved to 2 frames before the nearest word start within 20 frames (and after the previous cut); else left where it is. */
function snapToWord(cut: number, words: readonly { startFrame: number }[], after: number): number {
  let best = cut;
  let gap = 21;
  for (const w of words) {
    const at = w.startFrame - 2;
    if (at > after && Math.abs(at - cut) < gap) { best = at; gap = Math.abs(at - cut); }
  }
  return best;
}

/** Places scenes on the timeline: each beat's frames are shared by its scenes in proportion to their weights. */
export function layoutScenes(timing: Timing, scenes: readonly SceneIn[]): { frames: { from: number; to: number }[]; errors: string[] } {
  const errors: string[] = [];
  const beatIds = timing.beats.map((b) => b.id);
  for (const s of scenes) if (!beatIds.includes(s.beat)) errors.push(`a ${s.type} scene is on the ${s.beat} beat, which the script does not have`);
  const order = scenes.map((s) => beatIds.indexOf(s.beat)).filter((i) => i >= 0);
  if (order.some((v, i) => i > 0 && v < order[i - 1])) errors.push('scenes must be in beat order, the same order as the script');
  for (const id of beatIds) if (!scenes.some((s) => s.beat === id)) errors.push(`the ${id} beat has no scene`);
  if (errors.length) return { frames: [], errors };

  const frames: { from: number; to: number }[] = [];
  for (const b of timing.beats) {
    const mine = scenes.filter((s) => s.beat === b.id);
    const total = mine.reduce((n, s) => n + s.weight, 0);
    // The cuts inside a beat, by weight, then each moved onto the nearest spoken word so the visual lands with it.
    const cuts: number[] = [b.start];
    let acc = 0;
    for (const s of mine.slice(0, -1)) {
      acc += s.weight;
      cuts.push(snapToWord(b.start + Math.round(((b.end - b.start) * acc) / total), b.words ?? [], cuts[cuts.length - 1]));
    }
    cuts.push(b.end);
    for (let i = 0; i < mine.length; i++) frames.push({ from: cuts[i], to: cuts[i + 1] });
  }
  for (const f of frames) if (f.to - f.from < 30) errors.push(`a scene of ${f.to - f.from} frames is too short to read; give it more weight or drop a scene from its beat`);
  return { frames, errors };
}

const round1 = (n: number) => String(Math.round(n * 10) / 10);

/** "3.3× cheaper" for a change of 1.5× or more, else "10% better". The word carries the direction; `better` only colours. */
export function changeText(before: number, after: number, _better: 'lower' | 'higher', word: string): string {
  const ratio = Math.max(before, after) / Math.min(before, after);
  if (ratio >= 1.5) return `${round1(ratio)}× ${word}`;
  return `${Math.round((ratio - 1) * 100)}% ${word}`;
}

export const HANDLE = '@aiiolar';
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

export function receiptClaims(input: EditInput): string[] {
  return [...new Set(input.scenes.flatMap((s) => (s.type === 'Receipt' ? [s.claim] : s.type === 'AvatarTalk' && s.over ? [s.over] : [])))];
}

export type ResolveCtx = {
  slug: string; date: string; bed: string | null; timing: Timing; script: Script; claims: Claims; receipts: Record<string, ReceiptShot> | null;
  /** The reel's mode; AvatarTalk is only for `avatar`. Defaults to faceless. */
  mode?: 'faceless' | 'avatar';
  /** The demo clip and post ids the brief gave, e.g. ['demo-1']. */
  demos?: readonly string[];
  posts?: readonly string[];
  /** What the assets stage made; null (or absent) for a structure-only pass before it has run. */
  assets?: Assets | null;
  /** The reel's look. The creator look has pacing rules the newsroom look does not. */
  look?: Look;
};

const MAX_DEMO_SECONDS = 8;
/** In the creator look no scene without motion runs longer than this. */
export const MAX_STATIC_SECONDS = 2.5;
/** Scenes that are a card or a page. The face cam, b-roll and demo clips move; a count-up or bars animate only at the start, so they count as static. */
const STATIC_TYPES: ReadonlySet<SceneIn['type']> = new Set(['Headline', 'Receipt', 'PullQuote', 'DeltaCard', 'BenchmarkBars', 'PostCard', 'EndCard']);
/** The share of frames the presenter may take: half in the newsroom look, four fifths in the creator look. */
const talkShare = (look: Look | undefined) => (look === 'creator' ? 0.8 : 0.5);
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function resolveEdit(input: EditInput, ctx: ResolveCtx): { props: LaunchProps | null; errors: string[] } {
  const { frames, errors } = layoutScenes(ctx.timing, input.scenes);
  if (errors.length) return { props: null, errors };
  if (ctx.look === 'creator') {
    if (input.scenes[0].type === 'Headline') errors.push('the hook must open on the face cam (AvatarTalk photo) or a BRoll, never on a plain Headline');
    input.scenes.forEach((s, i) => {
      const secs = (frames[i].to - frames[i].from) / ctx.timing.fps;
      if (STATIC_TYPES.has(s.type) && secs > MAX_STATIC_SECONDS) errors.push(`a ${s.type} scene runs ${secs.toFixed(1)} seconds; a static scene may run at most ${MAX_STATIC_SECONDS}. Add a BRoll or AvatarTalk to its beat, or give it less weight`);
    });
    if (errors.length) return { props: null, errors };
  }
  const byId = new Map(ctx.claims.claims.map((c) => [c.id, c]));
  const claim = (id: string): Claim | null => {
    const c = byId.get(id);
    if (!c) errors.push(`${id} is not a claim`);
    return c ?? null;
  };
  const number = (id: string): (Claim & { value: number }) | null => {
    const c = claim(id);
    if (c && c.value === undefined) { errors.push(`${id} has no number; a number scene can only show claims with a value`); return null; }
    return c as (Claim & { value: number }) | null;
  };

  const scenes: Scene[] = [];
  input.scenes.forEach((s, i) => {
    const at = frames[i];
    if (s.type === 'Headline') scenes.push({ type: 'Headline', ...at, kicker: s.kicker, title: s.title, ...(s.dek ? { dek: s.dek } : {}), ...(s.facts?.length ? { facts: s.facts } : {}) });
    else if (s.type === 'EndCard') scenes.push({ type: 'EndCard', ...at, line: s.line, handle: HANDLE });
    else if (s.type === 'Receipt') {
      const c = claim(s.claim);
      if (!c) return;
      const shot = ctx.receipts?.[s.claim];
      if (ctx.receipts === null) {
        // Structure only: the screenshot does not exist yet. A placeholder keeps the scene count right.
        scenes.push({ type: 'Receipt', ...at, image: '', width: 1080, height: 1350, focus: [{ x: 0, y: 0, w: 1, h: 1 }], source: hostOf(c.url) });
      } else if (!shot) errors.push(`no screenshot was taken for ${s.claim}`);
      else if (!shot.focus) errors.push(`the quote for ${s.claim} was not found on ${shot.host}; pick another claim for this receipt or show it another way`);
      else scenes.push({ type: 'Receipt', ...at, image: `launch/${ctx.slug}/${shot.file}`, width: shot.width, height: shot.height, focus: shot.focus, source: shot.host, ...(s.caption ? { caption: s.caption } : {}) });
    } else if (s.type === 'PullQuote') {
      const c = claim(s.claim);
      if (c) scenes.push({ type: 'PullQuote', ...at, quote: c.quote, source: hostOf(c.url) });
    } else if (s.type === 'DeltaCard') {
      const a = number(s.before);
      const b = number(s.after);
      if (!a || !b) return;
      if ((a.unit ?? '') !== (b.unit ?? '')) { errors.push(`${s.before} is in "${a.unit ?? ''}" but ${s.after} is in "${b.unit ?? ''}"; a delta compares one unit`); return; }
      if (!(a.value > 0 && b.value > 0)) { errors.push(`${s.before} and ${s.after} must both be above zero for a delta`); return; }
      scenes.push({ type: 'DeltaCard', ...at, label: s.label, before: { value: a.value, unit: a.unit ?? '' }, after: { value: b.value, unit: b.unit ?? '' }, change: changeText(a.value, b.value, s.better, s.word), source: hostOf(b.url), ...(s.beforeLabel ? { beforeLabel: s.beforeLabel } : {}), ...(s.afterLabel ? { afterLabel: s.afterLabel } : {}) });
    } else if (s.type === 'BenchmarkBars') {
      const items = s.items.map((it) => ({ it, c: number(it.claim) }));
      if (items.some((x) => !x.c)) return;
      const units = [...new Set(items.map((x) => x.c!.unit ?? ''))];
      if (units.length > 1) { errors.push(`the bars "${s.title}" mix units ${units.map((u) => `"${u}"`).join(' and ')}; bars compare one unit`); return; }
      scenes.push({ type: 'BenchmarkBars', ...at, title: s.title, unit: units[0], items: items.map((x) => ({ label: x.it.label, value: x.c!.value, ours: x.it.ours })), source: hostOf(items[0].c!.url) });
    } else if (s.type === 'AvatarTalk') {
      if ((ctx.mode ?? 'faceless') !== 'avatar') { errors.push('AvatarTalk scenes are only for avatar mode reels; use a Receipt or another scene'); return; }
      if (s.layout === 'split' && !s.over) { errors.push('a split AvatarTalk needs an "over" claim: its receipt fills the bottom of the frame'); return; }
      const rec = ctx.assets?.assets[`avatar-${i}`];
      const scene: Extract<Scene, { type: 'AvatarTalk' }> = {
        type: 'AvatarTalk', ...at, layout: s.layout, video: rec?.file ? `launch/${ctx.slug}/${rec.file}` : null, portrait: `launch/${ctx.slug}/anchor.png`,
      };
      if (s.quote) {
        const narration = ctx.script.beats.find((b) => b.id === s.beat)?.narration ?? '';
        if (!` ${norm(narration)} `.includes(` ${norm(s.quote)} `)) { errors.push(`the pull-quote "${s.quote}" is not copied from the ${s.beat} narration; use 3 to 6 words exactly as spoken`); return; }
        scene.quote = s.quote;
      }
      if (s.over) {
        const c = claim(s.over);
        if (!c) return;
        const shot = ctx.receipts?.[s.over];
        if (ctx.receipts === null) scene.receipt = { image: '', width: 1080, height: 1350, focus: [{ x: 0, y: 0, w: 1, h: 1 }], source: hostOf(c.url) };
        else if (!shot) { errors.push(`no screenshot was taken for ${s.over}`); return; }
        else if (!shot.focus) { errors.push(`the quote for ${s.over} was not found on ${shot.host}; pick another claim to show over the anchor`); return; }
        else scene.receipt = { image: `launch/${ctx.slug}/${shot.file}`, width: shot.width, height: shot.height, focus: shot.focus, source: shot.host };
      }
      scenes.push(scene);
    } else if (s.type === 'BRoll') {
      const rec = ctx.assets?.assets[`broll-${i}`];
      if (!ctx.assets) scenes.push({ type: 'BRoll', ...at, image: '', ...(s.kicker ? { kicker: s.kicker } : {}), ...(s.title ? { title: s.title } : {}) });
      else if (rec?.file && rec.source !== 'swapped') scenes.push({ type: 'BRoll', ...at, image: `launch/${ctx.slug}/${rec.file}`, ...(rec.file.endsWith('.mp4') && rec.seconds ? { clipSeconds: rec.seconds } : {}), ...(s.kicker ? { kicker: s.kicker } : {}), ...(s.title ? { title: s.title } : {}) });
      else scenes.push({ type: 'Headline', ...at, kicker: s.kicker ?? 'THE NEWS', title: s.title ?? ctx.script.headline });
    } else if (s.type === 'DemoClip') {
      if (!ctx.demos?.includes(s.clip)) { errors.push(`${s.clip} is not one of the demo links this reel was given; use only demo clips the reel has`); return; }
      const secs = (at.to - at.from) / ctx.timing.fps;
      if (secs > MAX_DEMO_SECONDS) { errors.push(`a DemoClip may run at most ${MAX_DEMO_SECONDS} seconds and this one runs ${secs.toFixed(1)}; give it less weight or add a scene to its beat`); return; }
      const rec = ctx.assets?.assets[s.clip];
      if (!ctx.assets) scenes.push({ type: 'DemoClip', ...at, video: '', credit: s.credit });
      else if (!rec) errors.push(`no file was made for ${s.clip}`);
      else if (rec.source === 'refused' || !rec.file) errors.push(`${s.clip} cannot be used: ${rec.reason ?? 'it has no file'}; pick another scene`);
      else scenes.push({ type: 'DemoClip', ...at, video: `launch/${ctx.slug}/${rec.file}`, credit: s.credit, ...(rec.width && rec.height ? { width: rec.width, height: rec.height } : {}) });
    } else {
      if (!ctx.posts?.includes(s.post)) { errors.push(`${s.post} is not one of the X posts this reel was given; use only posts the reel has`); return; }
      const rec = ctx.assets?.assets[s.post];
      if (!ctx.assets) scenes.push({ type: 'PostCard', ...at, author: '', handle: '', date: '', text: '' });
      else if (!rec) errors.push(`no post text was fetched for ${s.post}`);
      else if (rec.source === 'refused' || !rec.post) errors.push(`${s.post} cannot be used: ${rec.reason ?? 'it has no text'}; pick another scene`);
      else scenes.push({ type: 'PostCard', ...at, ...rec.post });
    }
  });
  if (errors.length) return { props: null, errors };
  const receiptFrames = scenes.reduce((n, s) => n + (s.type === 'Receipt' ? s.to - s.from : 0), 0);
  const share = Math.round((receiptFrames * 100) / ctx.timing.totalFrames);
  if (receiptFrames > ctx.timing.totalFrames * 0.45) errors.push(`receipts take ${share}% of the reel; use at most 40% — turn some into PullQuote or number scenes`);
  // Variety: the same scene three times running reads as a slideshow.
  for (let i = 2; i < scenes.length; i++) {
    const t = scenes[i].type;
    if (scenes[i - 1].type === t && scenes[i - 2].type === t && scenes[i + 1]?.type !== t) {
      let k = i;
      while (k >= 0 && scenes[k].type === t) k--;
      errors.push(`${i - k} ${t} scenes in a row; never put more than 2 of one kind together`);
    }
  }
  const talkFrames = scenes.reduce((n, s) => n + (s.type === 'AvatarTalk' ? s.to - s.from : 0), 0);
  if (talkFrames > ctx.timing.totalFrames * talkShare(ctx.look)) errors.push(`AvatarTalk scenes take ${Math.round((talkFrames * 100) / ctx.timing.totalFrames)}% of the reel; use at most ${talkShare(ctx.look) * 100}%`);
  const quotes = scenes.filter((s) => s.type === 'PullQuote').length;
  if (quotes > 2) errors.push(`the reel has ${quotes} PullQuotes; use at most 2`);
  if (errors.length) return { props: null, errors };
  const emphasis = [...new Set(ctx.script.beats.flatMap((b) => b.emphasis))];
  return { props: { slug: ctx.slug, fps: 30, width: 1080, height: 1920, totalFrames: ctx.timing.totalFrames, date: ctx.date, bed: ctx.bed, emphasis, ...(ctx.look ? { look: ctx.look } : {}), timing: ctx.timing, scenes }, errors: [] };
}

const LIBRARY = `Scenes (pick from these only):
- Headline { "type": "Headline", "beat", "weight", "kicker" (<=24 chars), "title" (<=48), "dek" (<=90, optional), "facts" (optional, up to 3 of { "label" (<=14), "value" (<=12) }, e.g. CONTEXT / 1M tokens) }: a front-page headline on paper. Use it for the hook.
- Receipt { "type": "Receipt", "beat", "weight", "claim", "caption" (<=40, optional) }: a real screenshot of the claim's page with its quote highlighted. Use it when the page itself is the proof: a pricing table, a changelog line, a benchmark table.
- PullQuote { "type": "PullQuote", "beat", "weight", "claim" }: the claim's quote set large as a magazine pull quote, with its source. Use it for a company statement that is a sentence.
- DeltaCard { "type": "DeltaCard", "beat", "weight", "label" (<=32), "before", "after", "better": "lower"|"higher", "word" (<=12), "beforeLabel" (<=14, optional, e.g. "TODAY"), "afterLabel" (<=14, optional, e.g. "FROM DEC 1") }: an old number struck out and the new one large. Both claims need a value in the same unit. "word" must say the direction of the change ("cheaper", "pricier", "faster", "slower", "bigger"); "better" only decides the colour. The labels replace BEFORE / NOW when the two numbers are not simply old and new. Only for one thing changing (an old price and a new one, a price below and above a threshold, the previous version and this one); to compare two products use BenchmarkBars.
- BenchmarkBars { "type": "BenchmarkBars", "beat", "weight", "title" (<=40), "items": [ { "label" (<=20), "claim", "ours": boolean } ] }: 2 to 4 bars, one unit. "ours" marks the product launched.
- EndCard { "type": "EndCard", "beat", "weight", "line" (<=60) }: the sign-off. Use it for cta.`;

const AVATAR_SCENE =
  '- AvatarTalk { "type": "AvatarTalk", "beat", "weight", "layout": "columnist"|"photo"|"split", "over" (a claim id, optional; required for split), "quote" (<=60 chars, optional) }: the anchor of the channel speaks to camera while the beat plays. "columnist": the receipt of the "over" claim above, the anchor below it small, and "quote" set beside the anchor (3 to 6 words copied exactly from the narration of the beat). "photo": the anchor large (in the creator look, a full-screen face cam), no receipt. "split": the face cam fills the top 55% of the frame and the receipt of the "over" claim the bottom 45%, so the receipt stays up while the anchor talks. Use it for what, who and catch.';
const brollScenes = (creator: boolean) => [
  creator
    ? '- BRoll { "type": "BRoll", "beat", "weight", "prompt" (<=300: what the shot shows; no text, no logos, no real people), "motion" (<=160, optional: one slow camera move plus one small subject motion), "kicker" (<=24, optional) }: a short moving shot (a still brought to life) with a small kicker chip. The title is not shown in the creator look (kicker only): the caption is the text over the shot, so leave it out.'
    : '- BRoll { "type": "BRoll", "beat", "weight", "prompt" (<=300: what the shot shows; no text, no logos, no real people), "motion" (<=160, optional: one slow camera move plus one small subject motion), "kicker" (<=24, optional), "title" (<=48, optional) }: a short moving shot (a still brought to life) with a headline band. The hook may open with a BRoll and then the Headline.',
];
const DEMO_SCENE = '- DemoClip { "type": "DemoClip", "beat", "weight", "clip": "demo-1"|"demo-2"|"demo-3", "credit" (<=40, e.g. the company) }: an official demo video, at most 8 seconds on screen, credited. Use only the clip ids listed below. Use it for the demo beat.';
const POST_SCENE = '- PostCard { "type": "PostCard", "beat", "weight", "post": "post-1"|"post-2"|"post-3" }: an X post set on a card. Use only the post ids listed below, when the url of a cited claim is an X post.';

/** The reference's median shot length, kept inside what a scene may last (2 to 6 s), as text. */
const paceSec = (median: number) => String(Math.round(Math.min(6, Math.max(2, median)) * 10) / 10);

export function editPrompt(c: { brief: Brief; script: Script; claims: Claims; timing: Timing; errors?: string[]; notes?: string; previous?: EditInput }): string {
  const avatar = c.brief.mode === 'avatar';
  const creator = c.brief.look === 'creator';
  const demos = c.brief.demos ?? [];
  const posts = c.brief.posts ?? [];
  const secs = (id: string) => { const b = c.timing.beats.find((x) => x.id === id)!; return ((b.end - b.start) / c.timing.fps).toFixed(1); };
  const lines = [
    'You cut a short vertical reel about a tech launch. The voiceover is recorded; you choose what is on screen while each beat is spoken.',
    creator
      ? 'The look is a young Indian tech creator\'s feed: dark, fast, big capital headlines, a face cam, moving b-roll, real screenshots as receipts.'
      : 'The look is an editorial newspaper: paper, serif headlines, real screenshots as receipts.',
    '',
    LIBRARY,
    ...(avatar ? [AVATAR_SCENE] : []),
    ...(avatar || creator ? brollScenes(creator) : []),
    ...(demos.length ? [DEMO_SCENE, `  Demo clips this reel has: ${demos.map((d) => `${d.id} (${d.url})`).join(', ')}.`] : []),
    ...(posts.length ? [POST_SCENE, `  X posts this reel has: ${posts.map((d) => `${d.id} (${d.url})`).join(', ')}.`] : []),
    '',
    'The beats, in order, with their length and narration:',
    ...c.script.beats.map((b) => `- ${b.id} (${secs(b.id)} s, cites ${b.claims.join(', ') || 'nothing'}): ${b.narration}`),
    '',
    'Claims (id, value if any, what it says):',
    ...c.claims.claims.map((x) => `- ${x.id}${x.value !== undefined ? ` [${x.value} ${x.unit ?? ''}]` : ''}: ${x.text}`),
    '',
    'Return ONLY JSON, no prose, no fences: { "scenes": [ scene, ... ] }',
    '',
    'Rules:',
    ...(creator
      ? [
        '- Scenes are in beat order ("weight", 0.5 to 8, shares a beat between its scenes). Pace is fast: the average scene is about 2.5 seconds or less, and no scene without motion (Headline, Receipt, PullQuote, DeltaCard, BenchmarkBars, PostCard, EndCard) runs longer than 2.5 seconds; split a long beat into more scenes. Scenes with motion (AvatarTalk, BRoll, DemoClip) may run longer.',
        ...(avatar ? ['- The face cam is the spine of the reel: AvatarTalk scenes take up to 80% of the frames. Receipts, numbers and b-roll cut away from it for 1.5 to 2.5 seconds each; use the "split" layout so a receipt can stay up while the anchor talks.'] : []),
        `- The hook opens on the face cam (AvatarTalk "photo", in an anchor reel) or on a BRoll, never on a plain Headline. A Headline may follow it.`,
        '- BRoll scenes run 1.5 to 3 seconds, and the reel has 2 to 4 of them. Give each a "motion": one slow camera move plus one small subject motion.',
        '- Receipts still back every number: a number scene or a Receipt shows each figure the narration says.',
      ]
      : ['- Scenes are in beat order. Every beat has 1 to 3 scenes; a scene stays on screen 2 to 6 seconds ("weight" shares a beat between its scenes).']),
    ...(c.brief.reference && !creator ? [`- Pace: a channel's reel on this launch cuts about every ${paceSec(c.brief.reference.medianShotSec)} s. Aim for scenes of about ${paceSec(c.brief.reference.medianShotSec)} seconds.`] : []),
    `- hook: a Headline whose title says the change ("${c.script.headline}" is the script's headline; kicker "${c.script.kicker}").`,
    '- numbers: DeltaCard or BenchmarkBars for the numbers the narration says, then a Receipt of the page they come from if time allows.',
    '- what and catch: a Receipt of the claim the narration relies on.',
    '- cta: an EndCard.',
    '- At most one Receipt per beat, and Receipts take at most 40% of the frames of the reel. At most 2 PullQuotes in the reel, and never 3 scenes of one kind in a row.',
    '- Prefer a PullQuote for a company statement that is a sentence; use a Receipt when the page itself is the proof (a pricing table, a changelog line, a benchmark table). Numbers go in DeltaCard or BenchmarkBars.',
    '- Show only claims the beat cites or that prove what the beat says.',
    ...(avatar ? [
      `- This is an anchor reel: what, who and catch use AvatarTalk (layout "columnist" with the receipt of the beat as "over" and a 3 to 6 word "quote" copied from the narration, "split" with the receipt as "over", or "photo"). AvatarTalk scenes take at most ${creator ? 80 : 50}% of the frames of the reel.`,
      ...(creator ? [] : ['- The hook may open with a BRoll and then the Headline.']),
    ] : []),
    ...(demos.length ? ['- The demo beat uses a DemoClip of one of the clips this reel has.'] : []),
    ...(posts.length ? ['- Use a PostCard where the url of a cited claim is one of the X posts this reel has.'] : []),
  ];
  if (c.errors?.length) lines.push('', 'Your previous edit list was refused for these reasons; fix every one:', ...c.errors.map((e) => `- ${e}`));
  if (c.previous) lines.push('', 'The current edit list, to be revised:', JSON.stringify(c.previous));
  if (c.notes?.trim()) lines.push('', 'Notes (apply every one):', c.notes.trim());
  return lines.join('\n');
}

export async function generateEdit(c: Parameters<typeof editPrompt>[0], deps: { run: ClaudeRun }, check: (input: EditInput) => string[]): Promise<EditInput> {
  const base = editPrompt(c);
  let prompt = base;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const said = await deps.run(prompt, { model: 'opus', timeoutMs: 300_000 });
    try {
      const input = EditInputSchema.parse(extractJson(said));
      problems = check(input);
      if (!problems.length) return input;
    } catch (err) {
      problems = [err instanceof Error ? err.message.slice(0, 600) : String(err)];
    }
    prompt = editPrompt({ ...c, errors: problems });
  }
  throw new Error(`the edit list was refused twice:\n${problems.join('\n')}`);
}
