import { z } from 'zod';

/**
 * The explainer document, as the templates service on 26200 defines it.
 *
 * A reel is one scene that mutates, not a run of shots: the document declares the scene once and
 * each beat states what changes. This mirrors `models_explainer.py` in the plugin. The service
 * stays the authority — every document goes through `POST /validate` before it is rendered — but
 * the studio needs the shape locally to author against, to fold for the editor, and to say what
 * is wrong without a round trip.
 */

export const ROW_STATES = ['idle', 'good', 'warn', 'bad'] as const;
export const ICONS = ['none', 'server', 'cache', 'client', 'cloud', 'db'] as const;
export const ROLES = ['hook', 'step', 'payoff', 'cta'] as const;

export type RowState = (typeof ROW_STATES)[number];
export type Role = (typeof ROLES)[number];

export const RowSchema = z.object({
  id: z.string().min(1).max(24),
  label: z.string().min(1).max(28),
  value: z.number().nullable().default(null),
  unit: z.string().max(8).default(''),
  sub: z.string().max(40).nullable().default(null),
  state: z.enum(ROW_STATES).default('idle'),
  tier: z.number().int().min(0).max(3).default(0),
  col: z.number().int().min(0).max(5).default(0),
  icon: z.enum(ICONS).default('none'),
});

export const LinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(16).nullable().default(null),
  state: z.enum(ROW_STATES).default('idle'),
});

export const PanelLineSchema = z.object({
  text: z.string().min(1).max(48),
  state: z.enum(ROW_STATES).default('idle'),
});

export const SceneSchema = z.object({
  title: z.string().min(1).max(48),
  subtitle: z.string().max(90).nullable().default(null),
  rows: z.array(RowSchema).max(10).default([]),
  links: z.array(LinkSchema).max(12).default([]),
  note: z.string().max(90).nullable().default(null),
  panel: z.array(PanelLineSchema).max(4).default([]),
});

export const MutationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set'),
    row: z.string().min(1),
    label: z.string().max(28).optional(),
    value: z.number().nullable().optional(),
    unit: z.string().max(8).optional(),
    sub: z.string().max(40).nullable().optional(),
    state: z.enum(ROW_STATES).optional(),
    tier: z.number().int().min(0).max(3).optional(),
    col: z.number().int().min(0).max(5).optional(),
    icon: z.enum(ICONS).optional(),
  }),
  z.object({ op: z.literal('add'), row: RowSchema }),
  z.object({
    op: z.literal('link'),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().max(16).nullable().optional(),
    state: z.enum(ROW_STATES).default('idle'),
  }),
  z.object({
    op: z.literal('text'),
    field: z.enum(['title', 'subtitle', 'note']),
    to: z.string().max(90).nullable().default(null),
  }),
  z.object({ op: z.literal('panel'), text: z.string().min(1).max(48), state: z.enum(ROW_STATES).default('idle') }),
]);

export const BeatSchema = z.object({
  id: z.string().min(1).max(24),
  role: z.enum(ROLES),
  sec: z.number().gt(0).max(30).nullable().default(null),
  mutations: z.array(MutationSchema).max(8).default([]),
});

/**
 * What was asked for, kept with what was written.
 *
 * It travels on the document so a revise knows the brief without the user restating it, and so the
 * fit report can measure the length against the length that was wanted. The render service ignores
 * fields it does not know, so this costs the renderer nothing.
 */
export const BriefSchema = z.object({
  topic: z.string().max(200),
  audience: z.string().max(200),
  claim: z.string().max(300),
  seconds: z.number().gt(0).max(120),
});

export const ExplainerDocSchema = z.object({
  template: z.literal('explainer'),
  theme: z.string().min(1),
  ratio: z.enum(['9:16', '4:5', '1:1']).default('9:16'),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  brand: z.object({ handle: z.string().min(1).max(24), name: z.string().min(1).max(24) }),
  scene: SceneSchema,
  beats: z.array(BeatSchema).min(2).max(14),
  brief: BriefSchema.nullish(),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Row = z.infer<typeof RowSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type PanelLine = z.infer<typeof PanelLineSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Mutation = z.infer<typeof MutationSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type ExplainerDoc = z.infer<typeof ExplainerDocSchema>;

/** Per-role seconds when a beat does not set its own. Mirrors the contract's defaults. */
export const DEFAULT_SECS: Record<Role, number> = { hook: 3, step: 2, payoff: 4, cta: 3 };

export class FoldError extends Error {
  constructor(public readonly beatId: string, message: string) {
    super(message);
    this.name = 'FoldError';
  }
}

const clone = (s: Scene): Scene => ({
  ...s,
  rows: s.rows.map((r) => ({ ...r })),
  links: s.links.map((l) => ({ ...l })),
  panel: s.panel.map((p) => ({ ...p })),
});

/** One beat's mutations against a copy of the scene. Throws naming the beat and what is wrong. */
export function applyBeat(scene: Scene, beat: Beat): Scene {
  const out = clone(scene);
  const find = (id: string) => out.rows.find((r) => r.id === id);
  for (const m of beat.mutations) {
    if (m.op === 'add') {
      if (find(m.row.id)) throw new FoldError(beat.id, `row "${m.row.id}" is added twice`);
      out.rows.push({ ...m.row });
    } else if (m.op === 'set') {
      const targets = m.row === '*' ? out.rows : out.rows.filter((r) => r.id === m.row);
      if (!targets.length) throw new FoldError(beat.id, `set refers to row "${m.row}", which does not exist yet`);
      for (const t of targets) {
        if (m.label !== undefined) t.label = m.label;
        if ('value' in m) t.value = m.value ?? null;
        if (m.unit !== undefined) t.unit = m.unit;
        if ('sub' in m) t.sub = m.sub ?? null;
        if (m.state !== undefined) t.state = m.state;
        if (m.tier !== undefined) t.tier = m.tier;
        if (m.col !== undefined) t.col = m.col;
        if (m.icon !== undefined) t.icon = m.icon;
      }
    } else if (m.op === 'link') {
      for (const end of [m.from, m.to]) {
        if (!find(end)) throw new FoldError(beat.id, `link refers to row "${end}", which does not exist yet`);
      }
      const existing = out.links.find((l) => l.from === m.from && l.to === m.to);
      if (existing) {
        existing.state = m.state;
        if (m.label !== undefined) existing.label = m.label ?? null;
      } else {
        if (out.links.length >= 12) throw new FoldError(beat.id, 'the scene holds at most twelve links');
        out.links.push({ from: m.from, to: m.to, label: m.label ?? null, state: m.state });
      }
    } else if (m.op === 'text') {
      if (m.field === 'title') out.title = m.to ?? '';
      else if (m.field === 'subtitle') out.subtitle = m.to ?? null;
      else out.note = m.to ?? null;
    } else {
      if (out.panel.length >= 4) throw new FoldError(beat.id, 'the panel holds at most four lines');
      out.panel.push({ text: m.text, state: m.state });
    }
  }
  return out;
}

export type Step = { beat: Beat; scene: Scene; startFrame: number; durationFrames: number };

/**
 * The scene as it stands at each beat, with the frame window it occupies.
 *
 * The editor draws from this: selecting a beat shows the board exactly as the render will, with
 * no call to the service.
 */
export function foldDoc(doc: ExplainerDoc): Step[] {
  const out: Step[] = [];
  let scene = doc.scene;
  let cursor = 0;
  for (const beat of doc.beats) {
    scene = applyBeat(scene, beat);
    const sec = beat.sec ?? DEFAULT_SECS[beat.role];
    // half rounds up, matching timing_explainer.build_timeline
    const durationFrames = Math.max(1, Math.floor(sec * doc.fps + 0.5));
    out.push({ beat, scene, startFrame: cursor, durationFrames });
    cursor += durationFrames;
  }
  return out;
}

export const totalFrames = (doc: ExplainerDoc): number =>
  foldDoc(doc).reduce((n, s) => n + s.durationFrames, 0);

export const totalSeconds = (doc: ExplainerDoc): number => totalFrames(doc) / doc.fps;
