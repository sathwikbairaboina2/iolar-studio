import { FUNCTIONS, type JobsFile, type ReelJob } from './reelSchema';

/**
 * The reel's summary tiles, computed here with the plugin's own arithmetic
 * (jobs-reel-plugin lib/summarise/summarise.ts and buckets.ts, ported verbatim minus the
 * highlight scorer). The page shows these before a cut is submitted, so what you see is
 * what the reel will say. tests/jobs.summarise.test.ts holds this to the plugin's own
 * week 2026-W46 output.
 */

export type BucketKey = 'fresher' | 'junior' | 'mid' | 'senior';

export const EXPERIENCE_BUCKETS: { key: BucketKey; label: string; min: number; max: number }[] = [
  { key: 'fresher', label: '0–1 years', min: 0, max: 1 },
  { key: 'junior', label: '2–3 years', min: 2, max: 3 },
  { key: 'mid', label: '4–6 years', min: 4, max: 6 },
  { key: 'senior', label: '7+ years', min: 7, max: Number.POSITIVE_INFINITY },
];

export function experienceBucket(minYears: number): BucketKey {
  return EXPERIENCE_BUCKETS.find((b) => minYears >= b.min && minYears <= b.max)!.key;
}

export const SALARY_BANDS: { band: string; min: number; max: number }[] = [
  { band: '0–10L', min: 0, max: 1_000_000 },
  { band: '10–20L', min: 1_000_000, max: 2_000_000 },
  { band: '20–30L', min: 2_000_000, max: 3_000_000 },
  { band: '30–50L', min: 3_000_000, max: 5_000_000 },
  { band: '50L+', min: 5_000_000, max: Number.POSITIVE_INFINITY },
];

/** Bands on the midpoint, or whichever end exists. No salary at all means no band. */
export function salaryBand(job: Pick<ReelJob, 'salaryMin' | 'salaryMax'>): string | null {
  const { salaryMin: lo, salaryMax: hi } = job;
  const value = lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi);
  if (value === null) return null;
  return SALARY_BANDS.find((b) => value >= b.min && value < b.max)!.band;
}

const LABELS: Record<string, string> = {
  engineering: 'Engineering',
  data: 'Data',
  design: 'Design',
  product: 'Product',
  operations: 'Operations',
  sales: 'Sales',
  marketing: 'Marketing',
  finance: 'Finance',
  hr: 'HR',
  other: 'Other',
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function topN(counts: Map<string, number>, n: number): { key: string; count: number }[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

export type SummaryTiles = {
  week: string;
  generatedAt: string;
  total: number;
  counted: number;
  rejected: number;
  byFunction: { key: string; label: string; count: number; share: number }[];
  byExperience: { key: BucketKey; label: string; count: number; share: number }[];
  byWorkMode: { remote: number; hybrid: number; onsite: number };
  topCities: { city: string; count: number }[];
  bySalary: { band: string; count: number }[];
  salaryCoverage: number;
  topEmployers: { company: string; count: number }[];
  closingSoon: { within7Days: number; nextDeadline: string | null };
};

export function summarise(file: Pick<JobsFile, 'week' | 'jobs' | 'rejected'>, now: Date): SummaryTiles {
  const jobs = file.jobs;
  const counted = jobs.length;
  const share = (n: number) => (counted === 0 ? 0 : round4(n / counted));

  const fnCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  const employerCounts = new Map<string, number>();
  const bandCounts = new Map<string, number>();
  const bucketCounts = new Map<string, number>();
  const modes = { remote: 0, hybrid: 0, onsite: 0 };
  let withSalary = 0;

  for (const j of jobs) {
    fnCounts.set(j.function, (fnCounts.get(j.function) ?? 0) + 1);
    cityCounts.set(j.location, (cityCounts.get(j.location) ?? 0) + 1);
    employerCounts.set(j.company, (employerCounts.get(j.company) ?? 0) + 1);
    modes[j.workMode] += 1;
    const bucket = experienceBucket(j.experienceMin);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    const band = salaryBand(j);
    if (band) {
      withSalary += 1;
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
    }
  }

  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const deadlines = jobs
    .map((j) => j.closesOn)
    .filter((d): d is string => d !== null && d >= today)
    .sort();

  return {
    week: file.week,
    generatedAt: now.toISOString(),
    total: counted,
    counted,
    rejected: file.rejected.length,
    byFunction: FUNCTIONS.map((key) => ({ key, label: LABELS[key]!, count: fnCounts.get(key) ?? 0 }))
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .map((f) => ({ ...f, share: share(f.count) })),
    byExperience: EXPERIENCE_BUCKETS.map((b) => {
      const count = bucketCounts.get(b.key) ?? 0;
      return { key: b.key, label: b.label, count, share: share(count) };
    }),
    byWorkMode: modes,
    topCities: topN(cityCounts, 5).map((c) => ({ city: c.key, count: c.count })),
    bySalary: SALARY_BANDS.map((b) => ({ band: b.band, count: bandCounts.get(b.band) ?? 0 })).filter((b) => b.count > 0),
    salaryCoverage: counted === 0 ? 0 : round4(withSalary / counted),
    topEmployers: topN(employerCounts, 5).map((e) => ({ company: e.key, count: e.count })),
    closingSoon: {
      within7Days: deadlines.filter((d) => d <= horizon).length,
      nextDeadline: deadlines[0] ?? null,
    },
  };
}
