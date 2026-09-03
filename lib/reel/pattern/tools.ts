import { z } from 'zod';
import { extractJson } from '@/lib/ai/revise';
import type { Script } from '../research/script';
import { SectionError, type CandidateRef, type DocInput, type Limits, type PatternDef, type PromptInput, type Unit } from './types';

/**
 * Pattern `tools`: hook, slides, web, cta. The service's template.json fixes the order and
 * the limits; this file mirrors the shape and adds the one thing the service does not know
 * about — which script lines each unit speaks.
 */

const lineIds = z.array(z.string().min(1));
const StatSchema = z.object({ label: z.string(), value: z.number(), prefix: z.string().default(''), suffix: z.string().default('') });
export const HookSectionSchema = z.object({
  kind: z.literal('hook'),
  lineIds,
  title: z.string(),
  chips: z.array(z.string()).default([]),
  tease: z.string().nullable().default(null),
  /** The lipsync render of the hook, once made; an uploaded clip needs none. */
  assetId: z.string().optional(),
});
/** A point as the model may write it: the text, or the text with the phrase of the line it should land on. */
const PointInSchema = z.union([z.string(), z.object({ text: z.string(), anchor: z.string().nullable().default(null) })]);
export const SlideSchema = z.object({
  lineIds,
  topic: z.string(),
  points: z.array(z.string()),
  /** One per point, or null: the phrase inside the slide's lines the point lands on. */
  anchors: z.array(z.string().nullable()).default([]),
  image: z.string().nullable().default(null),
  stats: z.array(StatSchema).default([]),
});
export const SlidesSectionSchema = z.object({ kind: z.literal('slides'), slides: z.array(SlideSchema) });
export const PageSchema = z.object({ lineIds, url: z.string(), label: z.string().nullable().default(null) });
export const WebSectionSchema = z.object({ kind: z.literal('web'), pages: z.array(PageSchema) });
export const CtaSectionSchema = z.object({ kind: z.literal('cta'), lineIds, keyword: z.string(), line: z.string(), follow: z.string() });
export const ToolsSectionSchema = z.discriminatedUnion('kind', [HookSectionSchema, SlidesSectionSchema, WebSectionSchema, CtaSectionSchema]);
export const ToolsSectionsSchema = z.array(ToolsSectionSchema);

export type HookSection = z.infer<typeof HookSectionSchema>;
export type SlidesSection = z.infer<typeof SlidesSectionSchema>;
export type WebSection = z.infer<typeof WebSectionSchema>;
export type CtaSection = z.infer<typeof CtaSectionSchema>;
export type ToolsSection = z.infer<typeof ToolsSectionSchema>;

const ORDER = ['hook', 'slides', 'web', 'cta'] as const;

function units(sections: unknown[]): Unit[] {
  const out: Unit[] = [];
  (sections as ToolsSection[]).forEach((s, i) => {
    if (s.kind === 'hook') out.push({ path: `sections.${i}`, label: 'hook', kind: 'hook', lineIds: s.lineIds });
    else if (s.kind === 'cta') out.push({ path: `sections.${i}`, label: 'cta', kind: 'cta', lineIds: s.lineIds });
    else if (s.kind === 'slides') s.slides.forEach((sl, j) => out.push({ path: `sections.${i}.slides.${j}`, label: `slide ${j + 1}`, kind: 'slide', lineIds: sl.lineIds }));
    else s.pages.forEach((p, j) => out.push({ path: `sections.${i}.pages.${j}`, label: `page ${j + 1}`, kind: 'page', lineIds: p.lineIds }));
  });
  return out;
}

const over = (path: string, what: string, got: number, limit: number) => new SectionError(path, `${what} is ${got}, the limit is ${limit}`);

function check(raw: unknown[], script: Script, candidates: Record<string, CandidateRef>, limits: Limits): SectionError[] {
  const parsed = ToolsSectionsSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return [new SectionError(['sections', ...i.path].join('.'), i.message)];
  }
  const sections = parsed.data;
  const errs: SectionError[] = [];

  // Kinds: hook and cta once each, others at most once, template order.
  const kinds = sections.map((s) => s.kind);
  for (const k of ['hook', 'cta'] as const) if (!kinds.includes(k)) errs.push(new SectionError('sections', `a ${k} section is required`));
  for (const k of ORDER) if (kinds.filter((x) => x === k).length > 1) errs.push(new SectionError('sections', `the ${k} section may appear once, not twice`));
  const ranks = kinds.map((k) => ORDER.indexOf(k));
  if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) errs.push(new SectionError('sections', `sections must follow the order ${ORDER.join(', ')}`));
  if (errs.length) return errs;

  // Lines: every one placed once, units in script order, no empty unit.
  const order = new Map([...script.lines].sort((a, b) => a.order - b.order).map((l, i) => [l.id, i]));
  const seen = new Map<string, string>();
  let cursor = -1;
  for (const u of units(sections)) {
    if (u.lineIds.length === 0) errs.push(new SectionError(u.path, `${u.label} speaks no line`));
    for (const id of u.lineIds) {
      const rank = order.get(id);
      if (rank === undefined) {
        errs.push(new SectionError(u.path, `${id} is not a line of this script`));
        continue;
      }
      if (seen.has(id)) errs.push(new SectionError(u.path, `${id} is placed twice (${seen.get(id)} and ${u.label})`));
      seen.set(id, u.label);
      if (rank < cursor) errs.push(new SectionError(u.path, `${id} is out of order: ${u.label} comes after a later line`));
      cursor = Math.max(cursor, rank);
    }
  }
  for (const id of order.keys()) if (!seen.has(id)) errs.push(new SectionError('sections', `${id} is missing from every section`));

  // Limits, as the service states them.
  const len = (s: string) => s.trim().length;
  sections.forEach((s, i) => {
    const at = `sections.${i}`;
    if (s.kind === 'hook') {
      if (len(s.title) === 0 || len(s.title) > limits.title) errs.push(over(`${at}.title`, 'title length', len(s.title), limits.title));
      if (s.chips.length > limits.chips) errs.push(over(`${at}.chips`, 'chip count', s.chips.length, limits.chips));
      s.chips.forEach((c, j) => {
        if (len(c) === 0 || len(c) > limits.chip) errs.push(over(`${at}.chips.${j}`, 'chip length', len(c), limits.chip));
      });
      if (s.tease !== null && len(s.tease) > limits.title) errs.push(over(`${at}.tease`, 'tease length', len(s.tease), limits.title));
    } else if (s.kind === 'slides') {
      if (s.slides.length === 0 || s.slides.length > 12) errs.push(over(`${at}.slides`, 'slide count', s.slides.length, 12));
      s.slides.forEach((sl, j) => {
        const p = `${at}.slides.${j}`;
        if (len(sl.topic) === 0 || len(sl.topic) > limits.topic) errs.push(over(`${p}.topic`, 'topic length', len(sl.topic), limits.topic));
        if (sl.points.length === 0 || sl.points.length > limits.points) errs.push(over(`${p}.points`, 'point count', sl.points.length, limits.points));
        sl.points.forEach((pt, k) => {
          if (len(pt) === 0 || len(pt) > limits.point) errs.push(over(`${p}.points.${k}`, 'point length', len(pt), limits.point));
        });
        if (sl.stats.length > 3) errs.push(over(`${p}.stats`, 'stat count', sl.stats.length, 3));
        if (sl.image !== null && !/^https?:\/\//.test(sl.image)) errs.push(new SectionError(`${p}.image`, 'image must be an http(s) url or null'));
      });
    } else if (s.kind === 'web') {
      if (s.pages.length === 0 || s.pages.length > 10) errs.push(over(`${at}.pages`, 'page count', s.pages.length, 10));
      const urls = new Set(Object.values(candidates).map((c) => c.url));
      s.pages.forEach((pg, j) => {
        const p = `${at}.pages.${j}`;
        if (!urls.has(pg.url)) errs.push(new SectionError(`${p}.url`, `${pg.url} is not one of the script's sources`));
        if (pg.label !== null && len(pg.label) > 20) errs.push(over(`${p}.label`, 'label length', len(pg.label), 20));
      });
    } else {
      if (len(s.keyword) === 0 || len(s.keyword) > limits.keyword) errs.push(over(`${at}.keyword`, 'keyword length', len(s.keyword), limits.keyword));
      if (len(s.line) === 0 || len(s.line) > limits.title) errs.push(over(`${at}.line`, 'line length', len(s.line), limits.title));
      if (len(s.follow) === 0 || len(s.follow) > limits.title) errs.push(over(`${at}.follow`, 'follow length', len(s.follow), limits.title));
    }
  });
  return errs;
}

/** Points written as `{ text, anchor }` become `points` plus a parallel `anchors` list. */
function normalisePoints(sections: unknown[]): unknown[] {
  return sections.map((s) => {
    const sec = s as { kind?: string; slides?: Record<string, unknown>[] };
    if (sec.kind !== 'slides' || !Array.isArray(sec.slides)) return s;
    return {
      ...sec,
      slides: sec.slides.map((sl) => {
        const raw = Array.isArray(sl.points) ? (sl.points as unknown[]) : [];
        const parsed = raw.map((p) => PointInSchema.safeParse(p));
        if (!parsed.every((p) => p.success)) return sl;
        const items = parsed.map((p) => (typeof p.data === 'string' ? { text: p.data, anchor: null } : p.data!));
        return { ...sl, points: items.map((p) => p.text), anchors: items.map((p) => p.anchor) };
      }),
    };
  });
}

function parse(raw: string, script: Script, candidates: Record<string, CandidateRef>, limits: Limits): unknown[] {
  const data = extractJson(raw) as { sections?: unknown[] };
  const sections = normalisePoints(Array.isArray(data.sections) ? data.sections : []);
  if (sections.length === 0) throw new SectionError('sections', 'the answer has no sections');
  const errs = check(sections, script, candidates, limits);
  if (errs.length) throw errs[0];
  return ToolsSectionsSchema.parse(sections);
}

function prompt(input: PromptInput): string {
  const { script, candidates, brand, limits, themes } = input;
  const lines = [...script.lines]
    .sort((a, b) => a.order - b.order)
    .map((l) => `[${l.id}] (${l.role}) ${l.text}${l.citations.length ? `  sources: ${l.citations.filter((c) => candidates[c]).join(', ')}` : ''}`)
    .join('\n');
  const sources = Object.values(candidates)
    .map((c) => `${c.id}: ${c.url} — ${c.title}${c.thumbnailUrl ? ` (image: ${c.thumbnailUrl})` : ''}`)
    .join('\n');
  const shape = `Return ONLY JSON (no prose, no markdown fences):
{ "sections": [
  { "kind": "hook",   "lineIds": [...], "title": string, "chips": [string], "tease": string|null },
  { "kind": "slides", "slides": [ { "lineIds": [...], "topic": string, "points": [ { "text": string, "anchor": string } ], "image": string|null, "stats": [ { "label": string, "value": number, "prefix": string, "suffix": string } ] } ] },
  { "kind": "web",    "pages":  [ { "lineIds": [...], "url": string, "label": string|null } ] },
  { "kind": "cta",    "lineIds": [...], "keyword": string, "line": string, "follow": string }
] }`;
  const rules = [
    `Sections in this order: hook, slides, web, cta. hook and cta are required; slides and web are optional; each kind at most once.`,
    `Use every line id exactly once, in script order, walking the units hook, slide 1, slide 2, ..., page 1, ..., cta. A unit with no lines is invalid. The hook takes the opening line(s); the cta takes the closing line(s).`,
    `The lineIds decide how long each unit is on screen (the voice reads those lines). Give a slide the lines it illustrates; give a page the line(s) that cite its url.`,
    `Limits, strict: title ≤ ${limits.title} chars; ≤ ${limits.chips} chips of ≤ ${limits.chip} chars; per slide: topic ≤ ${limits.topic} chars, 1–${limits.points} points of ≤ ${limits.point} chars each, ≤ 3 stats; keyword ≤ ${limits.keyword} chars; cta line and follow ≤ ${limits.title} chars; tease ≤ ${limits.title} chars or null; page label ≤ 20 chars. Over the limit is rejected, never truncated.`,
    `A page url must be copied exactly from the sources list; never invent one. A slide image is a source's image url or null. Stats only when a line states a number.`,
    `Each point lands on screen when its "anchor" is spoken: the anchor is a short phrase (2–5 words) copied exactly from one of that slide's lines, in the order the points appear. Points are shown one at a time as the voice reaches them.`,
    `On-screen copy is written fresh and short; the voice already says the lines, so the screen adds, never repeats. Brand: ${brand.name} (${brand.handle}). Themes available: ${themes.join(', ') || 'default'}.`,
  ].join('\n');
  const errors = input.errors?.length ? `Your previous answer was rejected:\n- ${input.errors.join('\n- ')}\nFix exactly those and answer again.` : '';
  return [`Split this approved reel script into the "tools" template's sections.`, `SCRIPT LINES:\n${lines}`, `SOURCES:\n${sources || '(none)'}`, rules, errors, shape]
    .filter(Boolean)
    .join('\n\n');
}

function doc(input: DocInput): unknown {
  const { reel, script, times, brand, captions, assets } = input;
  const sections = input.sections as ToolsSection[];
  // Voiced: the service cuts every unit to the words it is given, so no `sec` is sent (a
  // hand-written one is capped at 30 there, and a spoken slide may run longer). Unvoiced:
  // the measured defaults stand in.
  const voiced = Boolean(assets.vo) && assets.words.length > 0;
  const lineText = new Map(script.lines.map((l) => [l.id, l.text.trim()]));
  const speechOf = (ids: string[]) => ids.map((id) => lineText.get(id) ?? '').filter(Boolean).join(' ');
  const secAt = new Map(times.map((t) => [t.path, t.sec]));
  const timing = (p: string, ids: string[]) => (voiced ? { speech: speechOf(ids) } : { sec: secAt.get(p) ?? 5 });
  const body = sections.map((s, i) => {
    const at = `sections.${i}`;
    if (s.kind === 'hook') return { kind: 'hook', ...timing(at, s.lineIds), presenter: assets.presenter ?? 'fixture://presenter.mp4', title: s.title, chips: s.chips, tease: s.tease };
    if (s.kind === 'slides') {
      return {
        kind: 'slides',
        slides: s.slides.map((sl, j) => ({
          ...timing(`${at}.slides.${j}`, sl.lineIds),
          topic: sl.topic,
          points: sl.points.map((text, k) => (sl.anchors?.[k] ? { text, anchor: sl.anchors[k] } : text)),
          image: sl.image,
          stats: sl.stats,
        })),
      };
    }
    if (s.kind === 'web') return { kind: 'web', pages: s.pages.map((pg, j) => ({ ...timing(`${at}.pages.${j}`, pg.lineIds), url: pg.url, label: pg.label })) };
    return { kind: 'cta', ...timing(at, s.lineIds), keyword: s.keyword, line: s.line, follow: s.follow };
  });
  return {
    template: 'tools',
    theme: reel.pattern?.theme ?? 'glass-bento',
    ratio: reel.ratio,
    fps: reel.fps,
    brand: { handle: brand.handle.slice(0, 24), name: brand.name.slice(0, 24) },
    sections: body,
    ...(assets.vo ? { vo: { file: assets.vo, words: assets.words } } : {}),
    captions: { enabled: captions && assets.words.length > 0 },
    music: { file: null, gainDb: -18, duckDb: -12 },
  };
}

export const tools: PatternDef = {
  name: 'tools',
  SectionsSchema: ToolsSectionsSchema,
  prompt,
  parse,
  check,
  units,
  doc,
};
