import { z } from 'zod';

export const DecisionSchema = z
  .object({
    state: z.enum(["keep", "reject", "undecided"]),
    starred: z.boolean(),
    note: z.string().nullable(),
  })
  .strict();

export const SelectionSchema = z
  .object({
    runId: z.string().min(1),
    updatedAt: z.string().datetime(),
    decisions: z.record(z.string().regex(/^[0-9a-f]{12}$/), DecisionSchema),
    fetchRequestedAt: z.string().datetime().nullable(),
  })
  .strict();

export type Decision = z.infer<typeof DecisionSchema>;
export type Selection = z.infer<typeof SelectionSchema>;

export function parseSelection(raw: unknown): Selection {
  const parsed = SelectionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`selection.json: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return parsed.data;
}

export function emptySelection(runId: string): Selection {
  return { runId, updatedAt: new Date().toISOString(), decisions: {}, fetchRequestedAt: null };
}
