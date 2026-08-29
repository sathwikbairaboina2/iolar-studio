import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { patternDir, patternsRoot } from '../paths';

const PatternSchema = z.object({
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
  voice: z
    .object({ higgsfieldVoiceId: z.string().default(''), rate: z.number().default(1) })
    .prefault({}),
  letterbox: z.object({ bg: z.string().default('#ffffff') }).prefault({}),
});

export type Pattern = z.infer<typeof PatternSchema>;
export type PatternMeta = { name: string; displayName: string; draft: boolean };

export function validatePattern(data: unknown): Pattern {
  return PatternSchema.parse(data);
}

export async function loadPattern(name: string): Promise<Pattern> {
  const file = path.join(patternDir(name), 'pattern.json');
  return validatePattern(JSON.parse(await fs.readFile(file, 'utf8')));
}

export async function listPatterns(): Promise<PatternMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(patternsRoot(), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: PatternMeta[] = [];
  for (const name of dirs) {
    try {
      const p = await loadPattern(name);
      out.push({ name: p.name, displayName: p.displayName, draft: name.endsWith('-draft') });
    } catch {
      // A malformed pattern dir is skipped, not fatal.
    }
  }
  return out;
}

export function patternCss(name: string): Promise<string> {
  return fs.readFile(path.join(patternDir(name), 'caption.css'), 'utf8');
}

export async function patternHookHtml(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(patternDir(name), 'hook.html'), 'utf8');
  } catch {
    return '<div class="reel-hook-title">{{logo}}{{title}}</div>';
  }
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The only place pattern.json becomes CSS. Preview and export both call this. */
export function patternCssVars(p: Pattern): string {
  const c = p.caption;
  return [
    `--cap-font: ${c.font}`,
    `--cap-weight: ${c.weight}`,
    `--cap-size: ${c.sizeVh}vh`,
    `--cap-case: ${c.case}`,
    `--cap-fg: ${c.fg}`,
    `--cap-pill: ${rgba(c.pill, c.pillAlpha)}`,
    `--cap-radius: ${c.radiusVh}vh`,
    `--cap-pad-y: ${c.padVh[0]}vh`,
    `--cap-pad-x: ${c.padVh[1]}vh`,
    `--cap-y: ${c.yPct}%`,
    `--hook-size: ${p.hook.titleSizeVh}vh`,
    `--letterbox-bg: ${p.letterbox.bg}`,
  ].join('; ');
}
