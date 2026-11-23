import { z } from 'zod';

/**
 * One job, one card. The document every way in produces and every family renders:
 * a job URL read by the model, a pool row mapped across, or a draft corrected by
 * hand all end up here.
 *
 * Six things must be true before a card is worth posting — skill, company,
 * experience, location, eligibility, and a source to point at. The salary range and
 * the selection process join them when the source has them: a card prints "Not
 * disclosed" for pay nobody announced, and one that invents rounds is worse than a
 * card without that panel. `missingMandatory` names the gaps so the page can ask
 * rather than render a hole.
 */

export const FAMILIES = ['split-hero', 'infographic', 'campaign', 'bento', 'ticket', 'band-stack'] as const;
export type Family = (typeof FAMILIES)[number];

/** 3:4 for the tall families, 4:5 for the two that pack the width. */
const RATIO: Record<Family, [number, number]> = {
  'split-hero': [1080, 1440],
  infographic: [1080, 1350],
  campaign: [1080, 1440],
  bento: [1080, 1350],
  ticket: [1080, 1440],
  'band-stack': [1080, 1440],
};

export const ratioFor = (family: Family): [number, number] => RATIO[family];

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour is six hex digits behind a hash');

/** The first word of the company, upper-cased: what a viewer is asked to comment. */
const keywordFrom = (name: string) => (name.split(/[\s,.-]+/)[0] ?? 'JOBS').toUpperCase();

export const LogoSchema = z.object({
  /** A path under data/, never a remote URL: the renderer reads from disk. */
  src: z.string().min(1),
  /** Where it came from, so a card can say how sure it is of the mark. */
  kind: z.enum(['page', 'reference', 'search']),
});

export const JobCardSchema = z
  .object({
    company: z.object({
      name: z.string().min(1),
      logo: LogoSchema.nullable().default(null),
      accent: Hex.nullable().default(null),
    }),
    role: z.object({
      title: z.string().min(1),
      skills: z.array(z.string().min(1)).default([]),
      team: z.string().nullable().default(null),
    }),
    experience: z.object({
      min: z.number().int().min(0).nullable().default(null),
      max: z.number().int().min(0).nullable().default(null),
      label: z.string().min(1),
    }),
    location: z.object({
      city: z.string().min(1),
      region: z.string().nullable().default(null),
      workMode: z.enum(['onsite', 'hybrid', 'remote']),
    }),
    salary: z
      .object({
        min: z.number().min(0),
        max: z.number().min(0),
        currency: z.string().default('INR'),
        unit: z.string().default('LPA'),
        note: z.string().nullable().default(null),
      })
      .nullish(),
    eligibility: z.array(z.string().min(1)).default([]),
    selectionProcess: z
      .array(z.object({ step: z.number().int().min(1), label: z.string().min(1), detail: z.string().nullable().default(null) }))
      .default([]),
    dates: z
      .array(z.object({ kind: z.enum(['walk-in', 'deadline', 'test', 'drive']), date: z.string().min(1), time: z.string().nullable().default(null) }))
      .default([]),
    cta: z
      .object({
        keyword: z.string().min(1).optional(),
        channel: z.enum(['site', 'whatsapp', 'bio', 'dm']).default('site'),
        /** Where "apply" points, for the `site` channel: a page on aiiolar.com. */
        url: z.string().min(1).optional(),
      })
      .default({ channel: 'site' }),
    source: z.object({
      url: z.string().min(1),
      kind: z.enum(['job-url', 'pool', 'reference']),
      poolId: z.number().int().nullable().default(null),
      /** A pool card's family key, which aiiolar.com opens the job by. */
      familyKey: z.string().min(1).optional(),
    }),
    /** Set once the card has been sent on to IntaBot; the document's only memory of it. */
    handoff: z
      .object({ postId: z.string().min(1), accountId: z.string().min(1), at: z.string().min(1), status: z.literal('queued') })
      .optional(),
  })
  .transform((c) => ({ ...c, cta: { ...c.cta, keyword: keywordFrom(c.cta.keyword ?? c.company.name) } }))
  .refine((c) => !c.salary || c.salary.max >= c.salary.min, {
    message: 'the top of a salary range cannot sit below its floor',
    path: ['salary'],
  });

export type JobCard = z.infer<typeof JobCardSchema>;

export function parseJobCard(data: unknown): JobCard {
  return JobCardSchema.parse(data);
}

/**
 * What must be there before a card renders. Named the way the page says them, so
 * the message a user reads is this list and nothing is translated on the way out.
 */
/** A card on its way in: any field may be absent, and a half-typed object is still a draft.
 *  Lists stay whole — half an eligibility line is not a thing. */
export type JobCardDraft = {
  [K in keyof JobCard]?: JobCard[K] extends readonly unknown[] ? JobCard[K] : Partial<JobCard[K]>;
};

export const MANDATORY: { label: string; has: (d: JobCardDraft) => boolean }[] = [
  { label: 'company', has: (d) => !!d.company?.name },
  { label: 'role', has: (d) => !!d.role?.title },
  { label: 'skill', has: (d) => (d.role?.skills?.length ?? 0) > 0 },
  { label: 'experience', has: (d) => !!d.experience?.label },
  { label: 'location', has: (d) => !!d.location?.city },
  { label: 'eligibility', has: (d) => (d.eligibility?.length ?? 0) > 0 },
  { label: 'source', has: (d) => !!d.source?.url },
];

export function missingMandatory(draft: JobCardDraft): string[] {
  return MANDATORY.filter((m) => !m.has(draft)).map((m) => m.label);
}
