import { z } from 'zod';

/** Reels are vertical video; 9:16 is the default and the only one the studio is tuned for. */
export const REEL_RATIOS: Record<string, [number, number]> = {
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
};

export const SHOT_KINDS = ['title', 'talking-head', 'screen', 'broll'] as const;
export const CLIP_FITS = ['cover', 'contain'] as const;
export const CLIP_TRANSITIONS = ['cut', 'crossfade'] as const;
export const MOTION_TYPES = [
  'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'hold',
] as const;

const ShotSchema = z.object({
  kind: z.enum(SHOT_KINDS),
  brief: z.string().default(''),
  hero: z.boolean().default(false),
  assetId: z.string().optional(),
  /**
   * Further footage for the same line.
   *
   * One sentence of voiceover is rarely one shot: the reference cuts about every two
   * seconds, roughly twice per line. When a beat is long enough to split, the pieces walk
   * this list instead of all showing the same footage, which is what makes a split read as
   * a cut rather than a seam.
   */
  alsoAssetIds: z.array(z.string()).default([]),
});

const BeatSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['hook', 'body', 'close']),
  text: z.string().min(1),
  shot: ShotSchema,
});

const WordSchema = z.object({ w: z.string(), start: z.number(), end: z.number() });

const AssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['video', 'image', 'audio']),
  path: z.string(),
  origin: z.enum(['user', 'plugin', 'higgsfield']),
  status: z.enum(['queued', 'running', 'ready', 'failed', 'awaiting-manual']).default('queued'),
  jobId: z.string().optional(),
  brief: z.string().default(''),
  error: z.string().optional(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const MotionSchema = z.object({
  type: z.enum(MOTION_TYPES).default('zoom-in'),
  strength: z.number().min(0).max(1).default(0.12),
  origin: z.tuple([z.number(), z.number()]).default([0.5, 0.5]),
});

const ClipSchema = z
  .object({
    id: z.string().min(1),
    assetId: z.string(),
    beatId: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    srcIn: z.number().min(0).default(0),
    fit: z.enum(CLIP_FITS).default('cover'),
    motion: MotionSchema.prefault({}),
    transition: z.enum(CLIP_TRANSITIONS).default('cut'),
    locked: z.boolean().default(false),
  })
  .refine((c) => c.end > c.start, { message: 'clip end must be after start' });

const CaptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
  })
  .refine((c) => c.end > c.start, { message: 'caption end must be after start' });

const OverlaySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['hook-title']),
  start: z.number().min(0),
  end: z.number().min(0),
  props: z.record(z.string(), z.any()).default({}),
  locked: z.boolean().default(false),
});

const TimelineSchema = z.object({
  clips: z.array(ClipSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  overlays: z.array(OverlaySchema).default([]),
  music: z
    .object({
      path: z.string().nullable().default(null),
      gainDb: z.number().default(-18),
      duckDb: z.number().default(-12),
    })
    .prefault({}),
});

export const ReelSchema = z.object({
  brand: z.string().default('iolar'),
  pattern: z.string().default('armand'),
  ratio: z.enum(['9:16', '4:5', '1:1']).default('9:16'),
  fps: z.number().int().min(24).max(60).default(30),
  seed: z.number().int().default(42),
  title: z.string(),
  beats: z.array(BeatSchema).min(1),
  vo: z
    .object({
      provider: z.enum(['local', 'higgsfield', 'manual']).default('local'),
      voiceId: z.string().default(''),
      file: z.string().default('vo.mp3'),
      durationSec: z.number().default(0),
      words: z.array(WordSchema).default([]),
    })
    .prefault({}),
  assets: z.array(AssetSchema).default([]),
  timeline: TimelineSchema.prefault({}),
  caption: z
    .object({ text: z.string(), hashtags: z.array(z.string()) })
    .prefault({ text: '', hashtags: [] }),
});

export type Reel = z.infer<typeof ReelSchema>;
export type Beat = Reel['beats'][number];
export type ReelAsset = Reel['assets'][number];
export type Timeline = Reel['timeline'];
export type Clip = Timeline['clips'][number];
export type CaptionCue = Timeline['captions'][number];
export type Overlay = Timeline['overlays'][number];
export type Word = Reel['vo']['words'][number];

export function validateReel(data: unknown): Reel {
  return ReelSchema.parse(data);
}

export function emptyReel(slug: string, over: Partial<Reel> = {}): Reel {
  return validateReel({
    title: slug.replace(/-/g, ' '),
    beats: [{ id: 'b1', role: 'hook', text: 'New reel.', shot: { kind: 'title', brief: '' } }],
    ...over,
  });
}
