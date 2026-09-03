import { z } from 'zod';

/**
 * The style shape and everything derived from it, with no filesystem access.
 *
 * The studio player runs in the browser and needs `styleCssVars`, so this half must
 * stay importable from a client component. Loading a style off disk lives in
 * `styles.ts`, which is server-only.
 */

const StyleSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  caption: z.object({
    font: z.string(),
    weight: z.number().int(),
    sizeVh: z.number(),
    case: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
    fg: z.string(),
    pill: z.string(),
    pillAlpha: z.number().min(0).max(1),
    radiusVh: z.number(),
    padVh: z.tuple([z.number(), z.number()]),
    yPct: z.number().min(0).max(100),
    wordsPerBeat: z.tuple([z.number().int(), z.number().int()]),
    maxChars: z.number().int(),
  }),
  pacing: z.object({
    shotSec: z.tuple([z.number(), z.number()]),
    captionBeatSec: z.tuple([z.number(), z.number()]),
    cutOnWordBoundary: z.boolean().default(true),
  }),
  hook: z.object({
    layout: z.string(),
    durationSec: z.number(),
    titleSizeVh: z.number(),
    logoLockup: z.boolean().default(false),
  }),
  shotMix: z.object({
    talkingHead: z.number(),
    screen: z.number(),
    broll: z.number(),
    anchorEverySec: z.number(),
  }),
  motion: z.object({ default: z.string(), strength: z.number() }),
  transitions: z.array(z.enum(['cut', 'crossfade'])).min(1),
  voice: z.object({ rate: z.number().default(1) }).prefault({}),
  letterbox: z.object({ bg: z.string().default('#ffffff') }).prefault({}),
});

export type Style = z.infer<typeof StyleSchema>;
export type StyleMeta = { name: string; displayName: string; draft: boolean };

export function validateStyle(data: unknown): Style {
  return StyleSchema.parse(data);
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The only place style.json becomes CSS. Preview and export both call this.
 *
 * Lengths are emitted in container-query height units, not vh. The export renders in a
 * viewport the size of the frame, where the two agree, but the studio player is a small
 * box inside a browser window — with vh, a 6vh hook title came out nearly twice its
 * intended size on screen. `cqh` resolves against the stage in both.
 */
export function styleCssVars(p: Style): string {
  const c = p.caption;
  return [
    `--cap-font: ${c.font}`,
    `--cap-weight: ${c.weight}`,
    `--cap-size: ${c.sizeVh}cqh`,
    `--cap-case: ${c.case}`,
    `--cap-fg: ${c.fg}`,
    `--cap-pill: ${rgba(c.pill, c.pillAlpha)}`,
    `--cap-radius: ${c.radiusVh}cqh`,
    `--cap-pad-y: ${c.padVh[0]}cqh`,
    `--cap-pad-x: ${c.padVh[1]}cqh`,
    `--cap-y: ${c.yPct}%`,
    `--hook-size: ${p.hook.titleSizeVh}cqh`,
    `--letterbox-bg: ${p.letterbox.bg}`,
  ].join('; ');
}
