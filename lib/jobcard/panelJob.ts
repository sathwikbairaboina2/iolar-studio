import { createHash } from 'crypto';
import { z } from 'zod';
import { keywordFrom, type JobCardDraft } from './schema';

/**
 * A job as the control room keeps it: fixed fields plus an `attrs` bag for what varies by
 * source. The panel is the caller, so the shape is its own and is read leniently: only the
 * id is required, and whatever is absent becomes a gap the card names (`missing`) instead
 * of a refusal here. This file turns that job into the card document Studio renders.
 */

const Text = z.string().nullish();

const Round = z.union([
  z.string(),
  z.object({ label: Text, name: Text, title: Text, detail: Text }).passthrough(),
]);

const DATE_KINDS = ['walk-in', 'deadline', 'test', 'drive'] as const;
const DateItem = z.union([
  z.string(),
  z.object({ kind: Text, date: Text, time: Text }).passthrough(),
]);

export const PanelJobSchema = z
  .object({
    id: z.string().min(1),
    source: Text,
    sourceRef: Text,
    sourceUrl: Text,
    company: Text,
    role: Text,
    city: Text,
    region: Text,
    workMode: z.enum(['onsite', 'hybrid', 'remote']).nullish(),
    experience: z.object({ label: Text, min: z.number().nullish(), max: z.number().nullish() }).nullish(),
    salary: z
      .object({ min: z.number(), max: z.number(), unit: Text, currency: Text })
      .nullish(),
    applyUrl: Text,
    originalUrl: Text,
    status: Text,
    firstSeen: Text,
    attrs: z
      .object({
        skills: z.array(z.string()).nullish(),
        eligibility: z.array(z.string()).nullish(),
        rounds: z.array(Round).nullish(),
        dates: z.array(DateItem).nullish(),
        familyKey: Text,
        keyword: Text,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type PanelJob = z.infer<typeof PanelJobSchema>;

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '');
const words = (xs: (string | null | undefined)[] | null | undefined) => (xs ?? []).map(clean).filter(Boolean);

/** "2 - 5 Years" when the job has numbers and no wording of its own. */
function experienceLabel(e: NonNullable<PanelJob['experience']>): string | undefined {
  const own = clean(e.label);
  if (own) return own;
  if (typeof e.min === 'number' && typeof e.max === 'number') return `${e.min} - ${e.max} Years`;
  if (typeof e.min === 'number') return `${e.min}+ Years`;
  return undefined;
}

function rounds(job: PanelJob): NonNullable<JobCardDraft['selectionProcess']> {
  const out: NonNullable<JobCardDraft['selectionProcess']> = [];
  for (const r of job.attrs?.rounds ?? []) {
    const label = typeof r === 'string' ? clean(r) : clean(r.label) || clean(r.name) || clean(r.title);
    if (!label) continue;
    const detail = typeof r === 'string' ? '' : clean(r.detail);
    out.push({ step: out.length + 1, label, detail: detail || null });
  }
  return out;
}

function dates(job: PanelJob): NonNullable<JobCardDraft['dates']> {
  const out: NonNullable<JobCardDraft['dates']> = [];
  for (const d of job.attrs?.dates ?? []) {
    const date = typeof d === 'string' ? clean(d) : clean(d.date);
    if (!date) continue;
    const kind = typeof d === 'string' ? '' : clean(d.kind);
    const time = typeof d === 'string' ? '' : clean(d.time);
    out.push({
      kind: (DATE_KINDS as readonly string[]).includes(kind) ? (kind as (typeof DATE_KINDS)[number]) : 'deadline',
      date,
      time: time || null,
    });
  }
  return out;
}

/** What the job says, and nothing the card would have to invent. */
export function jobToDraft(job: PanelJob): JobCardDraft {
  const workMode = job.workMode ?? 'onsite';
  const city = clean(job.city) || (workMode === 'remote' ? 'Remote' : '');
  const familyKey = clean(job.attrs?.familyKey);
  const company = clean(job.company);
  const keyword = clean(job.attrs?.keyword) || (company ? keywordFrom(company) : '');

  const draft: JobCardDraft = {
    company: { name: company, logo: null, accent: null },
    role: { title: clean(job.role), skills: words(job.attrs?.skills), team: null },
    experience: {
      min: job.experience?.min ?? null,
      max: job.experience?.max ?? null,
      label: (job.experience && experienceLabel(job.experience)) as string,
    },
    location: { city, region: clean(job.region) || null, workMode },
    salary: job.salary
      ? { min: job.salary.min, max: job.salary.max, currency: clean(job.salary.currency) || 'INR', unit: clean(job.salary.unit) || 'LPA', note: null }
      : null,
    eligibility: words(job.attrs?.eligibility),
    selectionProcess: rounds(job),
    dates: dates(job),
    cta: {
      channel: 'site',
      ...(clean(job.applyUrl) ? { url: clean(job.applyUrl) } : {}),
      ...(keyword ? { keyword } : {}),
    },
    source: {
      url: clean(job.originalUrl) || clean(job.sourceUrl),
      kind: familyKey ? 'pool' : 'reference',
      poolId: null,
      ...(familyKey ? { familyKey } : {}),
    },
    panel: { jobId: job.id, hash: '' },
  };
  draft.panel = { jobId: job.id, hash: hashOf(draft) };
  return draft;
}

/** Same job, same hash: the draft without its own bookkeeping, so a change shows and a repeat does not. */
export function hashOf(draft: JobCardDraft): string {
  const { panel: _p, handoff: _h, ...rest } = draft;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}
