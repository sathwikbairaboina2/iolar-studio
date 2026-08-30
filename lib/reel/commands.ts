import { z } from 'zod';
import { CLIP_FITS, CLIP_TRANSITIONS, MOTION_TYPES, validateReel, type Reel } from './schema';
import { loadReel, saveReel } from './store';
import * as edits from './edits';
import * as history from './history';
import { publish } from './bus';
import type { Actor } from './history';

/**
 * The single write path into a reel.
 *
 * Every edit is a named command with a declared argument schema, so the studio
 * and an agent reach the same operations through the same door. `edits.ts` stays
 * pure and unaware of any of this — which is what keeps preview and export in
 * step, since no new editing semantics are introduced here.
 */

/** Which lane an id argument must be found in before the command runs. */
type Lane = 'clip' | 'caption' | 'asset';

type Command = {
  /** Name of the `edits.ts` function this wraps. A test pins the correspondence. */
  fn: keyof typeof edits;
  args: z.ZodTypeAny;
  /** Id arguments to resolve against the reel before applying. */
  refs?: { arg: string; lane: Lane }[];
  apply: (reel: Reel, args: never) => Reel;
  summary: (args: never) => string;
};

const clipId = z.string().min(1);
const cueId = z.string().min(1);
const sec = z.number().finite();

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}s`;

function command<S extends z.ZodTypeAny>(c: {
  fn: keyof typeof edits;
  args: S;
  refs?: { arg: string; lane: Lane }[];
  apply: (reel: Reel, args: z.infer<S>) => Reel;
  summary: (args: z.infer<S>) => string;
}): Command {
  return c as unknown as Command;
}

export const COMMANDS = {
  'clip.trim': command({
    fn: 'trimClip',
    args: z.object({ clipId, edge: z.enum(['in', 'out']), deltaSec: sec }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.trimClip(r, a.clipId, a.edge, a.deltaSec),
    summary: (a) => `trim ${a.clipId} ${a.edge} ${signed(a.deltaSec)}`,
  }),
  'clip.split': command({
    fn: 'splitClip',
    args: z.object({ clipId, atSec: sec.nonnegative() }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.splitClip(r, a.clipId, a.atSec),
    summary: (a) => `split ${a.clipId} at ${a.atSec}s`,
  }),
  'clip.delete': command({
    fn: 'deleteClip',
    args: z.object({ clipId }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.deleteClip(r, a.clipId),
    summary: (a) => `delete ${a.clipId}`,
  }),
  'clip.move': command({
    fn: 'moveClip',
    args: z.object({ clipId, toIndex: z.number().int().nonnegative() }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.moveClip(r, a.clipId, a.toIndex),
    summary: (a) => `move ${a.clipId} to slot ${a.toIndex}`,
  }),
  'clip.motion': command({
    fn: 'setClipMotion',
    args: z.object({
      clipId,
      motion: z
        .object({
          type: z.enum(MOTION_TYPES).optional(),
          strength: z.number().optional(),
          origin: z.tuple([z.number(), z.number()]).optional(),
        })
        .refine((m) => Object.keys(m).length > 0, 'motion needs at least one field'),
    }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.setClipMotion(r, a.clipId, a.motion as Parameters<typeof edits.setClipMotion>[2]),
    summary: (a) => `motion ${a.clipId} → ${a.motion.type ?? 'tweaked'}`,
  }),
  'clip.fit': command({
    fn: 'setClipFit',
    args: z.object({ clipId, fit: z.enum(CLIP_FITS) }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.setClipFit(r, a.clipId, a.fit),
    summary: (a) => `fit ${a.clipId} → ${a.fit}`,
  }),
  'clip.transition': command({
    fn: 'setClipTransition',
    args: z.object({ clipId, transition: z.enum(CLIP_TRANSITIONS) }),
    refs: [{ arg: 'clipId', lane: 'clip' }],
    apply: (r, a) => edits.setClipTransition(r, a.clipId, a.transition),
    summary: (a) => `transition ${a.clipId} → ${a.transition}`,
  }),
  'clip.asset': command({
    fn: 'replaceClipAsset',
    args: z.object({ clipId, assetId: z.string().min(1) }),
    refs: [
      { arg: 'clipId', lane: 'clip' },
      { arg: 'assetId', lane: 'asset' },
    ],
    apply: (r, a) => edits.replaceClipAsset(r, a.clipId, a.assetId),
    summary: (a) => `swap ${a.clipId} → asset ${a.assetId}`,
  }),
  'caption.edit': command({
    fn: 'editCaption',
    args: z.object({ cueId, text: z.string() }),
    refs: [{ arg: 'cueId', lane: 'caption' }],
    apply: (r, a) => edits.editCaption(r, a.cueId, a.text),
    summary: (a) => `caption ${a.cueId} → "${a.text}"`,
  }),
  'caption.nudge': command({
    fn: 'nudgeCaption',
    args: z.object({ cueId, deltaSec: sec }),
    refs: [{ arg: 'cueId', lane: 'caption' }],
    apply: (r, a) => edits.nudgeCaption(r, a.cueId, a.deltaSec),
    summary: (a) => `nudge ${a.cueId} ${signed(a.deltaSec)}`,
  }),
  'caption.toggle': command({
    fn: 'toggleCaption',
    args: z.object({ cueId }),
    refs: [{ arg: 'cueId', lane: 'caption' }],
    apply: (r, a) => edits.toggleCaption(r, a.cueId),
    summary: (a) => `toggle ${a.cueId}`,
  }),
  'caption.merge': command({
    fn: 'mergeCaption',
    args: z.object({ cueId }),
    refs: [{ arg: 'cueId', lane: 'caption' }],
    apply: (r, a) => edits.mergeCaption(r, a.cueId),
    summary: (a) => `merge ${a.cueId} with the next cue`,
  }),
  'caption.split': command({
    fn: 'splitCaption',
    args: z.object({ cueId }),
    refs: [{ arg: 'cueId', lane: 'caption' }],
    apply: (r, a) => edits.splitCaption(r, a.cueId),
    summary: (a) => `split ${a.cueId}`,
  }),
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;

export type CommandInput = { op: string; args: unknown; actor: Actor };

/**
 * Carries the HTTP status and a machine-readable detail, because an agent is a
 * first-class caller here: a rejection has to say what was wrong AND what valid
 * input looks like.
 */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

function idsInLane(reel: Reel, lane: Lane): string[] {
  if (lane === 'clip') return reel.timeline.clips.map((c) => c.id);
  if (lane === 'caption') return reel.timeline.captions.map((c) => c.id);
  return reel.assets.map((a) => a.id);
}

/**
 * Runs one command against a reel held in memory and returns the result.
 *
 * Everything that decides whether a command is legal lives here, so the dry run
 * and the real write path cannot disagree about what would happen. It touches
 * no disk and no bus; persistence is the caller's business.
 */
export function applyOne(
  reel: Reel,
  input: CommandInput
): { reel: Reel; op: string; summary: string; args: unknown } {
  const spec = (COMMANDS as Record<string, Command>)[input.op];
  if (!spec) {
    throw new CommandError(`unknown op "${input.op}"`, 400, { validOps: Object.keys(COMMANDS) });
  }

  const parsed = spec.args.safeParse(input.args);
  if (!parsed.success) {
    throw new CommandError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400, {
      op: input.op,
      schema: z.toJSONSchema(spec.args),
    });
  }
  const args = parsed.data as Record<string, string>;

  for (const ref of spec.refs ?? []) {
    const ids = idsInLane(reel, ref.lane);
    if (!ids.includes(args[ref.arg])) {
      throw new CommandError(`no ${ref.lane} "${args[ref.arg]}" on this reel`, 404, { validIds: ids });
    }
  }

  const next = spec.apply(reel, parsed.data as never);

  let valid: Reel;
  try {
    valid = validateReel(next);
  } catch (err) {
    throw new CommandError(`"${input.op}" would leave the reel invalid: ${String(err)}`, 409, {});
  }

  return { reel: valid, op: input.op, summary: spec.summary(parsed.data as never), args: parsed.data };
}

export async function loadReelOr404(slug: string): Promise<Reel> {
  try {
    return await loadReel(slug);
  } catch {
    throw new CommandError(`no reel "${slug}"`, 404, {});
  }
}

export async function applyCommand(
  slug: string,
  input: CommandInput
): Promise<{ reel: Reel; entry: history.Entry }> {
  const reel = await loadReelOr404(slug);
  const { reel: valid, summary, args: parsedArgs } = applyOne(reel, input);

  await saveReel(slug, valid);

  // Deliberately after the save. A failed log entry must not cost the user their
  // edit, so it is reported and swallowed rather than thrown.
  const meta = { op: input.op, args: parsedArgs, actor: input.actor, summary };
  let entry: history.Entry = { seq: -1, at: new Date().toISOString(), ...meta };
  try {
    const log = await history.push(slug, reel, valid, meta);
    entry = log.entries[log.cursor - 1] ?? entry;
  } catch (err) {
    console.error(`[reel] history write failed for ${slug}:`, err);
  }

  publish(slug, valid);
  return { reel: valid, entry };
}
