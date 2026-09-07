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
  'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall',
] as const;

const Ink = z.enum(['blue', 'red', 'green', 'black', 'accent']);

const BlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    /** Authors keep numbering their sections even when told not to, and their numbering runs
     *  across the whole part while a page numbers its own sections. It is stripped on the way
     *  in so the stored JSON says what the page shows. */
    text: z.string().min(1).transform((t) => t.replace(/^\s*\d+\s*[.)]\s*/, '').trim() || t),
    ink: Ink.optional(),
  }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1) }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('sidebox'), title: z.string(), items: z.array(z.string()).min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1) }),
  z.object({
    type: z.literal('code'),
    lang: z.string().default('python'),
    lines: z.array(z.string()).min(1),
    /** True when the snippet is a complete program: it gets executed by the verification gate.
     *  Illustrative fragments leave it unset and are only checked for broken structure. */
    runnable: z.boolean().optional(),
  }),
  z.object({ type: z.literal('diagram'), kind: z.enum(['flow', 'memory-cells', 'tree', 'compare']), spec: z.record(z.string(), z.any()) }),
  z.object({ type: z.literal('callout'), style: z.enum(['tip', 'takeaway', 'cloud']), title: z.string(), text: z.string() }),
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
