import type { CutRow } from './ledger';
import type { ResearchJob } from './researchApi';
import { FUNCTIONS, JobSchema, type JobFunction, type ReelJob, type WorkMode } from './reelSchema';

/**
 * One pool listing becomes one reel row, or a rejection with a reason. Rules first, and
 * one batched model call for the titles the rules could not place. Every decision is
 * visible on the cut: `mappedBy` says rule, qwen or rejected.
 */

// ---- function ----------------------------------------------------------------------

const FUNCTION_RULES: [JobFunction, RegExp][] = [
  ['hr', /\b(hr|human resources|recruit\w*|talent|people ops|people partner)\b/i],
  ['finance', /\b(finance|financial|accounts?|accountant|controller|treasury|fp&a|tax|audit)\b/i],
  ['marketing', /\b(marketing|growth|content|brand|seo|social media|community|communications?)\b/i],
  ['sales', /\b(sales|account (executive|manager)|business development|bd\b|partnerships?|pre-?sales|revenue)\b/i],
  ['design', /\b(design(er)?|ux|ui|visual|graphic|motion|illustrat\w*)\b/i],
  ['product', /\b(product manager|product management|product owner|product lead|\bpm\b|program manager|product specialist)\b/i],
  ['data', /\b(data|analytics?|analyst|machine learning|\bml\b|\bai\b|scientist|bi\b|etl)\b/i],
  ['engineering', /\b(engineer\w*|developer|dev\b|sde|swe|backend|frontend|front-end|full[- ]?stack|mobile|android|ios|devops|sre|qa|test\w*|architect|infra\w*|platform|security|embedded|firmware)\b/i],
  ['operations', /\b(operations?|ops\b|support|customer success|success|logistics|supply chain|procurement|admin\w*|office|coo)\b/i],
];

/** A label from the title or tags, or null when no rule fires; null goes to the model. */
export function mapFunction(title: string, tags: string[] = []): JobFunction | null {
  const hay = `${title} ${tags.join(' ')}`;
  for (const [fn, re] of FUNCTION_RULES) if (re.test(hay)) return fn;
  return null;
}

// ---- experience --------------------------------------------------------------------

const BANDS: [RegExp, [number, number]][] = [
  [/\b(intern|internship|trainee|apprentice)\b/i, [0, 1]],
  [/\b(junior|jr\.?|associate|entry[- ]level|fresher|graduate)\b/i, [0, 2]],
  [/\b(head of|director|vp\b|vice president|chief|cxo|c-level)\b/i, [10, 20]],
  [/\b(staff|principal|distinguished|lead\b|architect|manager)\b/i, [8, 15]],
  [/\b(senior|sr\.?|ii\b|iii\b)\b/i, [5, 9]],
];

export function mapExperience(title: string, description: string): { min: number; max: number } {
  const range = description.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*(?:years?|yrs?)/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max >= min && max <= 50) return { min, max };
  }
  const plus = description.match(/(\d{1,2})\s*\+\s*(?:years?|yrs?)/i);
  if (plus) {
    const min = Number(plus[1]);
    if (min <= 50) return { min, max: Math.min(50, min + 4) };
  }
  for (const [re, [min, max]] of BANDS) if (re.test(title)) return { min, max };
  return { min: 2, max: 5 };
}

// ---- work mode ---------------------------------------------------------------------

export function mapWorkMode(remote: boolean, location: string, description: string): WorkMode {
  if (remote || /\bremote\b/i.test(location)) return 'remote';
  if (/\bhybrid\b/i.test(location) || /\bhybrid\b/i.test(description.slice(0, 2000))) return 'hybrid';
  return 'onsite';
}

// ---- salary ------------------------------------------------------------------------

/**
 * INR only: the reel bands rupees. "₹12L - ₹18L", "12-18 LPA", "₹1.5M - ₹4M INR",
 * "INR 8,00,000". Anything in another currency is null, null: a wrong band is worse than
 * no band.
 */
export function mapSalaryInr(salary: string | null): { min: number | null; max: number | null } {
  if (!salary) return { min: null, max: null };
  const s = salary.replace(/,/g, '');
  const inr = /₹|\bINR\b|\bRs\.?\b|\bLPA\b|\blakhs?\b|\d\s*L\b/i.test(s);
  const foreign = /\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b|\bSGD\b|\bAED\b/i.test(s);
  if (!inr || foreign) return { min: null, max: null };
  const tokens = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(million|mn|m|crore|cr|lpa|lakhs?|l|k)?(?![a-z])/gi)].map((m) => ({
    n: Number(m[1]),
    unit: (m[2] ?? '').toLowerCase(),
  }));
  // "12-18 LPA": the bare 12 borrows the unit of the next number that has one.
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].unit) {
      const next = tokens.slice(i + 1).find((t) => t.unit);
      if (next) tokens[i].unit = next.unit;
    }
  }
  const scale = (n: number, unit: string) => {
    if (unit === 'm' || unit === 'mn' || unit === 'million') return n * 1_000_000;
    if (unit === 'cr' || unit === 'crore') return n * 10_000_000;
    if (unit === 'l' || unit === 'lpa' || unit.startsWith('lakh')) return n * 100_000;
    if (unit === 'k') return n * 1_000;
    return n;
  };
  const nums = tokens
    .map((t) => scale(t.n, t.unit))
    .filter((n) => n >= 50_000 && n <= 100_000_000)
    .map((n) => Math.round(n));
  if (!nums.length) return { min: null, max: null };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max };
}

// ---- location ----------------------------------------------------------------------

// One name per city, or the reel's "top cities" tile counts Bengaluru twice.
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru',
  bengaluru: 'Bengaluru',
  bengalore: 'Bengaluru',
  gurgaon: 'Gurugram',
  gurugram: 'Gurugram',
  bombay: 'Mumbai',
  mumbai: 'Mumbai',
  'new delhi': 'Delhi',
  delhi: 'Delhi',
  'delhi ncr': 'Delhi',
  ncr: 'Delhi',
  calcutta: 'Kolkata',
  kolkata: 'Kolkata',
  madras: 'Chennai',
  chennai: 'Chennai',
  poona: 'Pune',
  pune: 'Pune',
  hyderabad: 'Hyderabad',
  noida: 'Noida',
};

export function mapLocation(job: Pick<ResearchJob, 'location' | 'locations' | 'remote'>): string {
  const first = (job.locations?.[0] ?? job.location ?? '').split('/')[0].trim();
  const city = first
    .split(',')[0]
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*\)$/, '');
  if (city && !/^remote$/i.test(city)) {
    const alias = CITY_ALIASES[city.toLowerCase()];
    return alias ?? city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return job.remote ? 'Remote' : city || 'India';
}

// ---- row ---------------------------------------------------------------------------

export type MapResult = { ok: true; row: ReelJob } | { ok: false; reason: string };

export function mapRow(job: ResearchJob, periodKey: string, fn: JobFunction): MapResult {
  const exp = mapExperience(job.title, job.description ?? '');
  const sal = mapSalaryInr(job.salary);
  const candidate = {
    id: `${job.familyKey}|${periodKey}`,
    role: job.title.trim(),
    company: job.company.trim(),
    function: fn,
    location: mapLocation(job),
    workMode: mapWorkMode(job.remote, job.location ?? '', job.description ?? ''),
    experienceMin: exp.min,
    experienceMax: exp.max,
    salaryMin: sal.min,
    salaryMax: sal.max,
    currency: 'INR',
    postedOn: (job.postedAt ?? job.firstSeenAt ?? '').slice(0, 10),
    closesOn: null,
    link: job.url,
  };
  const parsed = JobSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}` };
  }
  return { ok: true, row: parsed.data };
}

/** Labels for titles no rule placed. One call per cut. Anything outside the ten labels is `other`. */
export type Classifier = (titles: string[]) => Promise<string[]>;

export async function mapRows(jobs: ResearchJob[], periodKey: string, classify: Classifier, cutId = 0): Promise<CutRow[]> {
  const fns = new Map<number, { fn: JobFunction; by: 'rule' | 'qwen' }>();
  const pending: ResearchJob[] = [];
  for (const j of jobs) {
    const fn = mapFunction(j.title, j.tags ?? []);
    if (fn) fns.set(j.id, { fn, by: 'rule' });
    else pending.push(j);
  }
  if (pending.length) {
    let labels: string[] = [];
    try {
      labels = await classify(pending.map((j) => j.title));
    } catch {
      labels = [];
    }
    pending.forEach((j, i) => {
      const raw = String(labels[i] ?? 'other').trim().toLowerCase();
      const fn = (FUNCTIONS as readonly string[]).includes(raw) ? (raw as JobFunction) : 'other';
      fns.set(j.id, { fn, by: 'qwen' });
    });
  }
  return jobs.map((j) => {
    const { fn, by } = fns.get(j.id)!;
    const m = mapRow(j, periodKey, fn);
    return m.ok
      ? { cutId, researchId: j.id, row: m.row as unknown as Record<string, unknown>, mappedBy: by, rejectReason: null }
      : { cutId, researchId: j.id, row: null, mappedBy: 'rejected', rejectReason: m.reason };
  });
}

/** The batched prompt for qwen. Exported so the cut can hand it the studio's runner. */
export function classifyPrompt(titles: string[]): string {
  return `Label each job title with exactly one of: ${FUNCTIONS.join(', ')}.
Reply with ONLY a JSON array of labels in the same order, one per title, nothing else.

${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
}

export function parseLabels(raw: string, n: number): string[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as unknown[];
    return Array.isArray(arr) ? arr.slice(0, n).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}
