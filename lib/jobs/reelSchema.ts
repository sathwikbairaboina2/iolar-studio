import { z } from 'zod';

/**
 * The jobs-reel plugin's input, as zod 4. Same rules as its lib/schema/jobs.ts (zod 3);
 * tests/jobs.reelSchema.test.ts proves the two accept and reject the same rows, so drift
 * is a failing test here rather than a 400 from the board.
 */

export const FUNCTIONS = ['engineering', 'data', 'design', 'product', 'operations', 'sales', 'marketing', 'finance', 'hr', 'other'] as const;
export type JobFunction = (typeof FUNCTIONS)[number];

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const JobSchema = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    company: z.string().min(1),
    function: z.enum(FUNCTIONS),
    location: z.string().min(1),
    workMode: z.enum(WORK_MODES),
    experienceMin: z.number().int().min(0).max(50),
    experienceMax: z.number().int().min(0).max(50),
    salaryMin: z.number().int().positive().nullable(),
    salaryMax: z.number().int().positive().nullable(),
    currency: z.string().length(3),
    postedOn: isoDate,
    closesOn: isoDate.nullable(),
    link: z.string().url(),
  })
  .refine((j) => j.experienceMax >= j.experienceMin, { message: 'experienceMax must be >= experienceMin', path: ['experienceMax'] })
  .refine((j) => j.salaryMin === null || j.salaryMax === null || j.salaryMax >= j.salaryMin, {
    message: 'salaryMax must be >= salaryMin',
    path: ['salaryMax'],
  });
export type ReelJob = z.infer<typeof JobSchema>;

export const RejectedRowSchema = z.object({
  row: z.number().int().positive(),
  why: z.string().min(1),
  raw: z.record(z.string(), z.string()),
});
export type RejectedRow = z.infer<typeof RejectedRowSchema>;

/** A week key today, a day key once the plugin renders days. */
export const PERIOD_KEY = /^\d{4}-W\d{2}$|^\d{4}-\d{2}-\d{2}$/;

export const JobsFileSchema = z.object({
  week: z.string().regex(PERIOD_KEY),
  importedAt: z.string().datetime(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('sheet'), url: z.string() }),
    z.object({ kind: z.literal('studio'), cutId: z.number().int(), pulledAt: z.string() }),
  ]),
  jobs: z.array(JobSchema),
  rejected: z.array(RejectedRowSchema),
  warnings: z.array(z.string()),
});
export type JobsFile = z.infer<typeof JobsFileSchema>;
