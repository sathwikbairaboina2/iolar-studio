import { z } from 'zod'

/**
 * The handbook file the studio exports and aiiolar renders. Blocks and diagrams are the studio's own (its lib/schema.ts),
 * plus three diagram kinds that older chapters still use. Keep in step with the studio; a block this side does not know
 * is kept as `unknown` and skipped when drawn, so a newer studio never breaks an older site.
 */
export const HANDBOOK_SCHEMA = 1

const Ink = z.enum(['blue', 'red', 'green', 'black', 'accent', 'purple', 'orange', 'pink'])
const Frame = z.enum(['none', 'solid', 'dashed'])
const FlowNode = z.union([z.string().min(1), z.object({ text: z.string().min(1), sub: z.string().optional(), ink: Ink.optional() })])

const Specs = {
  flow: z.object({ nodes: z.array(FlowNode).min(1) }),
  array: z.object({
    cells: z.array(z.string()).min(1),
    indices: z.boolean().default(true),
    pointers: z.array(z.object({ index: z.number().int().min(0), label: z.string(), ink: Ink.optional() })).default([]),
    highlight: z.array(z.number().int().min(0)).default([]),
    dim: z.array(z.number().int().min(0)).default([]),
    caption: z.string().optional(),
  }),
  flowchart: z.object({
    title: z.string().optional(),
    rows: z.array(z.array(z.string().min(1)).min(1)).min(1),
    nodes: z.record(z.string(), z.object({ text: z.string().min(1), shape: z.enum(['box', 'diamond', 'pill', 'icon']).default('box'), icon: z.string().optional(), ink: Ink.optional() })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).default([]),
  }),
  matrix: z.object({ rows: z.array(z.array(z.string()).min(1)).min(1), highlight: z.array(z.tuple([z.number().int(), z.number().int()])).default([]), caption: z.string().optional() }),
  cards: z.object({
    cards: z.array(z.object({ title: z.string().min(1), lines: z.array(z.string()).default([]), text: z.string().optional(), code: z.array(z.string()).optional(), chain: z.array(z.string()).optional(), icon: z.string().optional(), ink: Ink.optional() })).min(1),
  }),
  chain: z.object({ title: z.string().optional(), steps: z.array(z.object({ text: z.string().min(1), note: z.string().optional(), ink: Ink.optional() })).min(1) }),
  tables: z.object({ tables: z.array(z.object({ title: z.string().optional(), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1), caption: z.string().optional() })).min(1), arrow: z.boolean().default(false) }),
  schema: z.object({ tables: z.array(z.object({ name: z.string().min(1), columns: z.array(z.string().min(1)).min(1) })).min(1), links: z.array(z.object({ from: z.string(), to: z.string(), fromLabel: z.string().optional(), toLabel: z.string().optional(), arrow: z.boolean().default(false) })).default([]) }),
  er: z.object({ entities: z.array(z.object({ name: z.string().min(1), attrs: z.array(z.string()).default([]), key: z.string().optional() })).min(1), relations: z.array(z.object({ from: z.string(), to: z.string(), name: z.string().min(1), labels: z.tuple([z.string(), z.string()]).optional() })).default([]) }),
  // Legacy kinds: still in older chapters, no longer offered by the studio.
  compare: z.object({ left: z.object({ title: z.string(), items: z.array(z.string()) }), right: z.object({ title: z.string(), items: z.array(z.string()) }) }),
  tree: z.object({ root: z.string(), branches: z.array(z.lazy((): z.ZodType<unknown> => z.union([z.string(), z.object({ label: z.string(), children: z.array(z.union([z.string(), z.any()])).default([]) })]))) }),
  'memory-cells': z.object({ label: z.string().optional(), cells: z.array(z.string()).min(1) }),
} as const

const D = <K extends string, S extends z.ZodType>(kind: K, spec: S) => z.object({ type: z.literal('diagram'), kind: z.literal(kind), spec })
const Diagram = z.discriminatedUnion('kind', [
  D('flow', Specs.flow), D('array', Specs.array), D('flowchart', Specs.flowchart), D('matrix', Specs.matrix), D('cards', Specs.cards), D('chain', Specs.chain),
  D('tables', Specs.tables), D('schema', Specs.schema), D('er', Specs.er), D('compare', Specs.compare), D('tree', Specs.tree), D('memory-cells', Specs['memory-cells']),
])

const KnownBlock = z.union([
  z.object({ type: z.literal('heading'), text: z.string().min(1), ink: Ink.optional(), style: z.enum(['ribbon']).optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string().min(1), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().min(1)).min(1), style: z.string().optional(), frame: Frame.optional(), ink: Ink.optional() }),
  z.object({ type: z.literal('sidebox'), title: z.string(), items: z.array(z.string()).min(1), ink: Ink.optional() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1), highlightRow: z.number().int().min(0).optional(), frame: Frame.optional() }),
  z.object({ type: z.literal('code'), lang: z.string().default('python'), lines: z.array(z.string()).min(1), note: z.string().optional(), result: z.object({ headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())) }).optional() }),
  Diagram,
  z.object({ type: z.literal('callout'), style: z.string(), title: z.string().default(''), text: z.string() }),
  z.object({ type: z.literal('concept'), number: z.number().int().min(0), title: z.string().min(1), tagline: z.string().optional() }),
  z.object({ type: z.literal('labelrows'), rows: z.array(z.object({ icon: z.string().min(1), label: z.string().min(1), text: z.string().min(1) })).min(1) }),
  z.object({ type: z.literal('qa'), q: z.string(), a_bullets: z.array(z.string()).min(1), example_code: z.array(z.string()).optional() }),
])
const KNOWN = new Set(['heading', 'paragraph', 'bullets', 'sidebox', 'table', 'code', 'diagram', 'callout', 'concept', 'labelrows', 'qa'])
/** A known type must be valid; an unknown type passes through as `{ type: 'unknown' }` and is drawn as nothing. */
const Block = z.unknown().transform((v, ctx) => {
  const t = (v as { type?: unknown })?.type
  if (typeof t !== 'string' || !KNOWN.has(t)) return { type: 'unknown' as const, was: String(t) }
  const r = KnownBlock.safeParse(v)
  if (!r.success) {
    for (const i of r.error.issues) ctx.addIssue({ code: 'custom', message: `${t}: ${i.message}`, path: i.path })
    return z.NEVER
  }
  return r.data
})

const Cover = z.object({ title: z.string().min(1), subtitle: z.string().optional(), tagline: z.string().optional(), icons: z.array(z.object({ icon: z.string(), label: z.string(), sub: z.string().optional() })).default([]), pills: z.array(z.string()).default([]) })
const Page = z.object({ title: z.string(), blocks: z.array(Block), hero: z.string().optional(), aside: z.string().optional(), subtitle: z.string().optional(), kind: z.enum(['page', 'cover']).optional(), cover: Cover.optional() })
const Part = z.object({ n: z.number().int().min(1), title: z.string(), pages: z.array(Page).min(1) })
const Review = z.object({ passedAt: z.string(), passes: z.array(z.string()), approvedBy: z.enum(['ai', 'human', 'dev']) })
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)
const Chapter = z.object({
  slug: Slug, title: z.string().min(1), category: z.string(), summary: z.string(), prerequisites: z.array(Slug), minutes: z.number().int().min(1),
  hash: z.string().min(1), review: Review, parts: z.array(Part).min(1),
}).refine((c) => new Set(c.parts.map((p) => p.n)).size === c.parts.length, { message: 'part numbers must be unique' })

/**
 * Icons go into pages as markup, so only plain drawing is allowed: a fixed set of SVG elements and attributes, no
 * comments, no entities, and links only to an id inside the same SVG. Anything else (handlers, styles, scripts,
 * nested documents, encoded urls) fails the whole icon.
 */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'title', 'use'])
const SVG_ATTRS = new Set([
  'xmlns', 'xmlns:xlink', 'viewbox', 'width', 'height', 'class', 'id', 'role', 'aria-hidden', 'focusable', 'version',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'opacity', 'clip-rule', 'clip-path', 'mask', 'transform', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'pathlength',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'fx', 'fy', 'href', 'xlink:href', 'preserveaspectratio', 'maskunits', 'clippathunits',
])
const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))?)*)\s*\/?>/g
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g

export function safeSvg(svg: unknown): boolean {
  if (typeof svg !== 'string') return false
  const s = svg.trim()
  if (!/^<svg[\s>]/i.test(s) || /&|<!|<\?/.test(s)) return false
  let rest = ''
  let ok = true
  let last = 0
  for (const m of s.matchAll(TAG_RE)) {
    rest += s.slice(last, m.index)
    last = m.index! + m[0].length
    if (!SVG_TAGS.has(m[1].toLowerCase())) ok = false
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) {
      const name = a[1].toLowerCase()
      const value = a[2] ?? a[3] ?? ''
      if (!SVG_ATTRS.has(name)) ok = false
      if ((name === 'href' || name === 'xlink:href') && !/^#[\w-]+$/.test(value)) ok = false
      if (/url\(/i.test(value) && !/^url\(#[\w-]+\)$/i.test(value)) ok = false
    }
  }
  rest += s.slice(last)
  // Text between tags (a <title>) may not hide a tag the pattern above did not match.
  return ok && !/[<>]/.test(rest)
}

/** An icon's markup if the file has a safe one under this exact name (never an Object.prototype member). */
export function iconMarkup(icons: Record<string, string>, name: string | undefined): string | null {
  if (!name || !Object.hasOwn(icons, name)) return null
  const svg = icons[name]
  return safeSvg(svg) ? svg : null
}

const Handbook = z
  .object({
    schema: z.literal(HANDBOOK_SCHEMA), slug: Slug, name: z.string().min(1), emoji: z.string().default(''), logo: z.string().optional(),
    description: z.string(), summary: z.string().default(''), updatedAt: z.string(),
    order: z.array(Slug).min(1),
    orderReview: z.object({ confidence: z.number().min(0).max(1), approvedBy: z.enum(['ai', 'human', 'dev']), gaps: z.array(z.string()).default([]), overlaps: z.array(z.string()).default([]) }),
    icons: z.record(z.string(), z.string()).default({}),
    chapters: z.array(Chapter).min(1),
  })
  .superRefine((h, ctx) => {
    const slugs = h.chapters.map((c) => c.slug)
    const same = slugs.length === h.order.length && new Set(slugs).size === slugs.length && slugs.every((s) => h.order.includes(s))
    if (!same) ctx.addIssue({ code: 'custom', message: 'order must list every chapter exactly once' })
    const at = new Map(h.order.map((s, i) => [s, i]))
    for (const c of h.chapters)
      for (const p of c.prerequisites)
        if (!(at.has(p) && at.get(p)! < at.get(c.slug)!)) ctx.addIssue({ code: 'custom', message: `${c.slug}: prerequisite ${p} must come earlier in the order` })
    for (const [name, svg] of Object.entries(h.icons)) if (!safeSvg(svg)) ctx.addIssue({ code: 'custom', message: `icon ${name} is not a safe svg` })
  })

export type Handbook = z.infer<typeof Handbook>

export function parseHandbook(data: unknown): { ok: true; value: Handbook } | { ok: false; errors: string[] } {
  const r = Handbook.safeParse(data)
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
}
