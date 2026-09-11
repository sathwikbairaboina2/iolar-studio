import { z } from 'zod';
import * as edits from './edits';
import {
  ExplainerDocSchema, FoldError, ICONS, MutationSchema, ROLES, ROW_STATES, RowSchema, foldDoc,
  type ExplainerDoc,
} from './schema';
import type { Actor } from './history';

/**
 * The single write path into an explainer.
 *
 * Every edit is a named command with a declared argument schema, so the studio and an agent reach
 * the same operations through the same door. Two paths into one document drift; one cannot.
 */

type Command = {
  /** Name of the `edits.ts` function this wraps. A test pins the correspondence. */
  fn: keyof typeof edits;
  args: z.ZodTypeAny;
  /** Beat id to resolve against the document before the command runs. */
  beatRef?: string;
  apply: (doc: ExplainerDoc, args: never) => ExplainerDoc;
  summary: (args: never) => string;
};

function command<S extends z.ZodTypeAny>(c: {
  fn: keyof typeof edits;
  args: S;
  beatRef?: string;
  apply: (doc: ExplainerDoc, args: z.infer<S>) => ExplainerDoc;
  summary: (args: z.infer<S>) => string;
}): Command {
  return c as unknown as Command;
}

const rowPatchFields = {
  label: z.string().max(28).optional(),
  value: z.number().nullable().optional(),
  unit: z.string().max(8).optional(),
  sub: z.string().max(40).nullable().optional(),
  state: z.enum(ROW_STATES).optional(),
  tier: z.number().int().min(0).max(3).optional(),
  col: z.number().int().min(0).max(5).optional(),
  icon: z.enum(ICONS).optional(),
};

export const COMMANDS = {
  'doc.theme': command({
    fn: 'setTheme',
    args: z.object({ theme: z.string().min(1) }),
    apply: (d, a) => edits.setTheme(d, a.theme),
    summary: (a) => `theme ${a.theme}`,
  }),
  'doc.replace': command({
    fn: 'replaceDoc',
    args: z.object({ doc: ExplainerDocSchema }),
    apply: (d, a) => edits.replaceDoc(d, a.doc),
    summary: () => 'replace the document',
  }),
  'scene.text': command({
    fn: 'setSceneText',
    args: z.object({
      field: z.enum(['title', 'subtitle', 'note']),
      to: z.string().max(90).nullable(),
    }),
    apply: (d, a) => edits.setSceneText(d, a.field, a.to),
    summary: (a) => `set ${a.field}`,
  }),
  'scene.row.add': command({
    fn: 'addSceneRow',
    args: z.object({ row: RowSchema }),
    apply: (d, a) => edits.addSceneRow(d, a.row),
    summary: (a) => `add row "${a.row.id}"`,
  }),
  'scene.row.set': command({
    fn: 'setSceneRow',
    args: z.object({ rowId: z.string().min(1), ...rowPatchFields }),
    // rowId is destructured out: it addresses the row, it is not a field on it, and passing the
    // whole args object as the patch would write a stray rowId onto the row.
    apply: (d, { rowId, ...patch }) => edits.setSceneRow(d, rowId, patch),
    summary: (a) => `change row "${a.rowId}"`,
  }),
  'scene.row.remove': command({
    fn: 'removeSceneRow',
    args: z.object({ rowId: z.string().min(1) }),
    apply: (d, a) => edits.removeSceneRow(d, a.rowId),
    summary: (a) => `remove row "${a.rowId}"`,
  }),
  'scene.link': command({
    fn: 'setSceneLink',
    args: z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      state: z.enum(ROW_STATES).default('idle'),
      label: z.string().max(16).nullable().optional(),
    }),
    apply: (d, a) => edits.setSceneLink(d, a.from, a.to, a.state, a.label),
    summary: (a) => `link ${a.from} to ${a.to}`,
  }),
  'scene.panel.add': command({
    fn: 'addScenePanel',
    args: z.object({
      text: z.string().min(1).max(48),
      state: z.enum(ROW_STATES).default('idle'),
    }),
    apply: (d, a) => edits.addScenePanel(d, a.text, a.state),
    summary: (a) => `panel "${a.text}"`,
  }),
  'beat.add': command({
    fn: 'addBeat',
    args: z.object({ role: z.enum(ROLES), after: z.string().min(1).optional() }),
    apply: (d, a) => edits.addBeat(d, a.role, a.after),
    summary: (a) => `add a ${a.role} beat`,
  }),
  'beat.remove': command({
    fn: 'removeBeat',
    args: z.object({ beatId: z.string().min(1) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.removeBeat(d, a.beatId),
    summary: (a) => `remove ${a.beatId}`,
  }),
  'beat.move': command({
    fn: 'moveBeat',
    args: z.object({ beatId: z.string().min(1), toIndex: z.number().int().min(0) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.moveBeat(d, a.beatId, a.toIndex),
    summary: (a) => `move ${a.beatId}`,
  }),
  'beat.sec': command({
    fn: 'setBeatSec',
    args: z.object({ beatId: z.string().min(1), sec: z.number().gt(0).max(30).nullable() }),
    beatRef: 'beatId',
    apply: (d, a) => edits.setBeatSec(d, a.beatId, a.sec),
    summary: (a) => (a.sec === null ? `${a.beatId} back to its default length` : `${a.beatId} to ${a.sec}s`),
  }),
  'beat.role': command({
    fn: 'setBeatRole',
    args: z.object({ beatId: z.string().min(1), role: z.enum(ROLES) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.setBeatRole(d, a.beatId, a.role),
    summary: (a) => `${a.beatId} is now a ${a.role}`,
  }),
  'mutation.add': command({
    fn: 'addMutation',
    args: z.object({ beatId: z.string().min(1), mutation: MutationSchema }),
    beatRef: 'beatId',
    apply: (d, a) => edits.addMutation(d, a.beatId, a.mutation),
    summary: (a) => `${a.beatId}: ${a.mutation.op}`,
  }),
  'mutation.update': command({
    fn: 'updateMutation',
    args: z.object({
      beatId: z.string().min(1),
      index: z.number().int().min(0),
      mutation: MutationSchema,
    }),
    beatRef: 'beatId',
    apply: (d, a) => edits.updateMutation(d, a.beatId, a.index, a.mutation),
    summary: (a) => `${a.beatId}: change ${a.mutation.op}`,
  }),
  'mutation.remove': command({
    fn: 'removeMutation',
    args: z.object({ beatId: z.string().min(1), index: z.number().int().min(0) }),
    beatRef: 'beatId',
    apply: (d, a) => edits.removeMutation(d, a.beatId, a.index),
    summary: (a) => `${a.beatId}: drop one change`,
  }),
  'mutation.move': command({
    fn: 'moveMutation',
    args: z.object({
      beatId: z.string().min(1),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
    }),
    beatRef: 'beatId',
    apply: (d, a) => edits.moveMutation(d, a.beatId, a.from, a.to),
    summary: (a) => `${a.beatId}: reorder`,
  }),
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
export type CommandInput = { op: string; args: unknown; actor: Actor };

/**
 * Carries the HTTP status and a machine-readable detail, because an agent is a first-class caller
 * here: a rejection has to say what was wrong AND what valid input looks like.
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

/**
 * Runs one command against a document held in memory and returns the result.
 *
 * Everything that decides whether a command is legal lives here, so the dry run and the real write
 * path cannot disagree about what would happen. It touches no disk; persistence is the caller's.
 */
export function applyOne(
  doc: ExplainerDoc,
  input: CommandInput
): { doc: ExplainerDoc; op: string; summary: string; args: unknown } {
  const spec = (COMMANDS as Record<string, Command>)[input.op];
  if (!spec) {
    throw new CommandError(`unknown op "${input.op}"`, 400, { validOps: Object.keys(COMMANDS) });
  }

  const parsed = spec.args.safeParse(input.args);
  if (!parsed.success) {
    throw new CommandError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      400,
      { op: input.op, schema: z.toJSONSchema(spec.args) }
    );
  }
  const args = parsed.data as Record<string, unknown>;

  if (spec.beatRef) {
    const ids = doc.beats.map((b) => b.id);
    if (!ids.includes(String(args[spec.beatRef]))) {
      throw new CommandError(`no beat "${String(args[spec.beatRef])}" on this explainer`, 404, {
        validIds: ids,
      });
    }
  }

  const next = spec.apply(doc, parsed.data as never);

  let valid: ExplainerDoc;
  try {
    valid = ExplainerDocSchema.parse(next);
  } catch (err) {
    throw new CommandError(`"${input.op}" would leave the document invalid: ${String(err)}`, 400, {});
  }

  // The fold is a post-condition on every command: it is what makes it impossible to store a
  // document that cannot render. Moving a beat above the one that adds the row it sets is a
  // legal-looking edit, and this is where it fails.
  try {
    foldDoc(valid);
  } catch (err) {
    if (err instanceof FoldError) {
      throw new CommandError(`"${input.op}" would break beat ${err.beatId}: ${err.message}`, 422, {
        beatId: err.beatId,
      });
    }
    throw err;
  }

  return { doc: valid, op: input.op, summary: spec.summary(parsed.data as never), args: parsed.data };
}
