import { z } from 'zod';

/** Instagram shows 10 carousel images. Advisory: the UI warns past this, nothing rejects it. */
export const MAX_SLIDES = 10;

export const RATIOS: Record<string, [number, number]> = {
  '3:4': [1080, 1440],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
};

export const TEMPLATES = [
  'spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel',
  'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall', 'study-sheet',
] as const;

export const INKS = ['blue', 'red', 'green', 'black', 'accent', 'purple', 'orange'] as const;
export const FRAMES = ['none', 'solid', 'dashed'] as const;
export const BULLET_STYLES = ['dot', 'number', 'check', 'cross'] as const;
export const DIAGRAM_KINDS = ['flow', 'array', 'flowchart', 'matrix', 'cards'] as const;

const Ink = z.enum(INKS);
const Frame = z.enum(FRAMES);
export type Ink = z.infer<typeof Ink>;
export type Frame = z.infer<typeof Frame>;
export type BulletStyle = (typeof BULLET_STYLES)[number];

const FlowNode = z.union([z.string().min(1), z.object({ text: z.string().min(1), sub: z.string().optional(), ink: Ink.optional() })]);

export const DiagramSpecs = {
  flow: z.object({ nodes: z.array(FlowNode).min(1) }),
  array: z.object({
    cells: z.array(z.string()).min(1).max(20),
    indices: z.boolean().default(true),
    pointers: z.array(z.object({ index: z.number().int().min(0), label: z.string().min(1), ink: Ink.optional() })).default([]),
    highlight: z.array(z.number().int().min(0)).default([]),
    dim: z.array(z.number().int().min(0)).default([]),
    caption: z.string().optional(),
  }),
  flowchart: z
    .object({
      rows: z.array(z.array(z.string().min(1)).min(1).max(3)).min(2).max(7),
      nodes: z.record(z.string(), z.object({ text: z.string().min(1), shape: z.enum(['box', 'diamond', 'pill']).default('box'), ink: Ink.optional() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
    })
    .superRefine((s, ctx) => {
      const ids = new Set(s.rows.flat());
      if (ids.size > 12) ctx.addIssue({ code: 'custom', message: 'flowchart: at most 12 nodes' });
      for (const id of ids) if (!s.nodes[id]) ctx.addIssue({ code: 'custom', message: `flowchart: row references unknown node "${id}"` });
      for (const e of s.edges) for (const id of [e.from, e.to]) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `flowchart: edge references node "${id}" that is not in rows` });
    }),
  matrix: z.object({
    rows: z.array(z.array(z.string()).min(1)).min(1),
    highlight: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).default([]),
    caption: z.string().optional(),
  }),
  cards: z.object({
    cards: z.array(z.object({ title: z.string().min(1), lines: z.array(z.string()).min(1), ink: Ink.optional() })).min(2).max(4),
  }),
} as const;

export type DiagramSpec = { [K in keyof typeof DiagramSpecs]: { kind: K; spec: z.infer<(typeof DiagramSpecs)[K]> } }[keyof typeof DiagramSpecs];

const DiagramSchema = z.discriminatedUnion('kind', [
  z.object({ type: z.literal('diagram'), kind: z.literal('flow'), spec: DiagramSpecs.flow }),
  z.object({ type: z.literal('diagram'), kind: z.literal('array'), spec: DiagramSpecs.array }),
  z.object({ type: z.literal('diagram'), kind: z.literal('flowchart'), spec: DiagramSpecs.flowchart }),
  z.object({ type: z.literal('diagram'), kind: z.literal('matrix'), spec: DiagramSpecs.matrix }),
  z.object({ type: z.literal('diagram'), kind: z.literal('cards'), spec: DiagramSpecs.cards }),
]);

const BlockSchema = z.union([
  z.object({ type: z.literal('heading'), text: z.string().min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1)).min(1), style: z.enum(BULLET_STYLES).optional(), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('sidebox'), title: z.string(), items: z.array(z.string()).min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1), highlightRow: z.number().int().min(0).optional(), frame: Frame.optional() }),
  z.object({ type: z.literal('code'), lang: z.string().default('python'), lines: z.array(z.string()).min(1), note: z.string().optional() }),
  DiagramSchema,
  z.object({ type: z.literal('callout'), style: z.enum(['tip', 'takeaway', 'cloud', 'sticky', 'sticky-pink']), title: z.string(), text: z.string() }),
  z.object({ type: z.literal('qa'), q: z.string(), a_bullets: z.array(z.string()).min(1), example_code: z.array(z.string()).optional() }),
]);

export const PostSchema = z.object({
  brand: z.string().default('iolar'),
  template: z.enum(TEMPLATES).default('spiral-notes'),
  ratio: z.enum(['3:4', '4:5', '1:1']).default('3:4'),
  seed: z.number().int().default(42),
  series: z.string(),
  date: z.string(),
  slides: z
    .array(
      z.object({
        page_title: z.string(),
        blocks: z.array(BlockSchema).min(1),
        /** Set by auto-flow: this page holds content spilled from the page before it.
         *  Survives title rewrites, so a re-render can merge the chain and re-split evenly. */
        cont: z.boolean().optional(),
      })
    )
    .min(1),
  caption: z.object({ text: z.string(), hashtags: z.array(z.string()) }).default({ text: '', hashtags: [] }),
});

export type Post = z.infer<typeof PostSchema>;
export type Slide = Post['slides'][number];
export type Block = Slide['blocks'][number];

export function validatePost(data: unknown): Post {
  return PostSchema.parse(data);
}
