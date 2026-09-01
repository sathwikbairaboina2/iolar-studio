import { z } from 'zod';
import { validateReel, type Reel } from './schema';
import { loadReel, saveReel } from './store';
import * as edits from './edits';
import * as history from './history';
import { publish } from './bus';
import type { Actor } from './history';

/**
 * The single write path into a reel.
 *
 * Every edit is a named command with a declared argument schema, so the studio and an agent
 * reach the same operations through the same door.
 *
 * Cutting is not among them. Trimming, splitting, reordering and captioning happen in an
 * editor now — the studio hands over the recordings and takes back a finished file — so what
 * is left is the thing only the studio knows: the words each beat speaks.
 */

/** Which lane an id argument must be found in before the command runs. */
type Lane = 'beat' | 'asset';

type Command = {
  /** Name of the `edits.ts` function this wraps. A test pins the correspondence. */
  fn: keyof typeof edits;
  args: z.ZodTypeAny;
  /** Id arguments to resolve against the reel before applying. */
  refs?: { arg: string; lane: Lane }[];
  apply: (reel: Reel, args: never) => Reel;
  summary: (args: never) => string;
};

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
  'beat.text': command({
    fn: 'editBeatText',
    args: z.object({ beatId: z.string().min(1), text: z.string().min(1) }),
    // Checked against the reel before it runs, so a beat that is not there comes back as a
    // rejection naming the ones that are, rather than an exception from inside the edit.
    refs: [{ arg: 'beatId', lane: 'beat' }],
    apply: (r, a) => edits.editBeatText(r, a.beatId, a.text),
    summary: (a) => `rewrite ${a.beatId}`,
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
  if (lane === 'beat') return reel.beats.map((b) => b.id);
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
