import { z } from 'zod';
import { extractJson } from '@/lib/ai/revise';
import { mapExperience, mapLocation, mapSalaryInr, mapWorkMode } from '@/lib/jobs/map';
import type { ResearchJob } from '@/lib/jobs/researchApi';
import { JobCardDraft } from './schema';

/**
 * Two ways in, one document out. A pool row maps straight across — the research plugin
 * already read the listing — and a job URL is read here: the page's own JobPosting
 * markup first, because a site that publishes structured data is telling the truth
 * about itself, then the local model for the parts only prose says (eligibility, the
 * rounds), then the same rules the reel's mapper uses as the floor.
 *
 * Nothing invents. A field the page does not say stays missing, and `missingMandatory`
 * puts it in front of the user rather than into the card.
 */

export type Runner = (prompt: string, opts?: { timeoutMs?: number }) => Promise<string>;

/* ---------- the page ---------- */

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The og:image or a large icon: the first place a real mark is looked for. */
export function findLogo(html: string, base: string): string | null {
  const meta = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    ?? html.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]+href=["']([^"']+)["']/i);
  if (!meta) return null;
  try {
    return new URL(meta[1], base).toString();
  } catch {
    return null;
  }
}

type JsonLd = Record<string, unknown>;

/** Every JSON-LD block on the page, flattened through @graph. */
export function jsonLdBlocks(html: string): JsonLd[] {
  const out: JsonLd[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const push = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      const o = v as JsonLd;
      if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(push);
      out.push(o);
    };
    if (Array.isArray(parsed)) parsed.forEach(push);
    else push(parsed);
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A schema.org JobPosting as far as it goes; everything it does not say stays undefined. */
export function fromJobPosting(blocks: JsonLd[]): JobCardDraft {
  const post = blocks.find((b) => String(b['@type'] ?? '').includes('JobPosting'));
  if (!post) return {};

  const org = post.hiringOrganization as JsonLd | undefined;
  const place = ([] as unknown[]).concat(post.jobLocation ?? [])[0] as JsonLd | undefined;
  const address = place?.address as JsonLd | undefined;
  const salary = post.baseSalary as JsonLd | undefined;
  const value = salary?.value as JsonLd | undefined;

  const draft: JobCardDraft = {};
  const company = str(org?.name);
  if (company) draft.company = { name: company, logo: null, accent: null };
  const title = str(post.title);
  if (title) draft.role = { title, skills: [], team: null };

  const city = str(address?.addressLocality);
  if (city) {
    draft.location = {
      city,
      region: str(address?.addressRegion),
      workMode: /telecommute|remote/i.test(String(post.jobLocationType ?? '')) ? 'remote' : 'onsite',
    };
  }

  const lo = num(value?.minValue) ?? num(value?.value);
  const hi = num(value?.maxValue) ?? num(value?.value);
  if (lo !== null && hi !== null) {
    const unit = String(value?.unitText ?? 'YEAR').toUpperCase();
    // Indian listings quote a yearly figure in rupees; the card speaks in lakhs.
    const inLakh = unit === 'YEAR' && lo > 100_000;
    draft.salary = {
      min: inLakh ? Math.round(lo / 10_000) / 10 : lo,
      max: inLakh ? Math.round(hi / 10_000) / 10 : hi,
      currency: str(salary?.currency) ?? 'INR',
      unit: inLakh ? 'LPA' : unit === 'YEAR' ? 'per year' : unit.toLowerCase(),
      note: null,
    };
  }

  const closes = str(post.validThrough);
  if (closes) draft.dates = [{ kind: 'deadline', date: closes.slice(0, 10), time: null }];

  return draft;
}

/* ---------- the model ---------- */

const Facts = z.object({
  skills: z.array(z.string()).default([]),
  eligibility: z.array(z.string()).default([]),
  selectionProcess: z.array(z.object({ label: z.string(), detail: z.string().nullish() })).default([]),
  experienceLabel: z.string().nullish(),
  team: z.string().nullish(),
  salaryNote: z.string().nullish(),
});

const PROMPT = (text: string) => `You are reading one job listing. Reply with JSON only.

{
  "skills": ["the named tools, languages and frameworks, shortest form, at most 6"],
  "eligibility": ["who may apply: degree, marks, batch, backlogs, notice period. One rule per line."],
  "selectionProcess": [{ "label": "a round the listing announces", "detail": "what it covers, or null" }],
  "experienceLabel": "the experience as the listing words it, e.g. 2 – 5 Years, or null",
  "team": "the team or department, or null",
  "salaryNote": "any caveat printed beside the pay, or null"
}

Rules. Say only what the listing says. An empty list is the right answer when the
listing does not say. Never invent a round nobody announced, a degree nobody asked
for, or a number nobody printed.

LISTING
${text}`;

export async function factsFromText(text: string, run: Runner): Promise<z.infer<typeof Facts>> {
  const reply = await run(PROMPT(text.slice(0, 12_000)), { timeoutMs: 180_000 });
  const parsed = Facts.safeParse(extractJson(reply));
  return parsed.success ? parsed.data : Facts.parse({});
}

/* ---------- the two ways in ---------- */

const expLabel = (min: number, max: number) => `${min} – ${max} Years`;

function merge(...drafts: JobCardDraft[]): JobCardDraft {
  const out: JobCardDraft = {};
  for (const d of drafts) {
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * A pool row is already read: title, company, location, work mode, salary and experience
 * map straight across. Only what the row cannot say — eligibility, the rounds — is asked
 * of the model, and only when a runner is given.
 */
export async function fromPoolRow(job: ResearchJob, run?: Runner): Promise<JobCardDraft> {
  const exp = mapExperience(job.title, job.description ?? '');
  const inr = mapSalaryInr(job.salary);
  const city = mapLocation(job);
  const facts = run ? await factsFromText(`${job.title} at ${job.company}\n\n${job.description ?? ''}`, run) : null;

  const base: JobCardDraft = {
    company: { name: job.company.trim(), logo: null, accent: null },
    role: { title: job.title.trim(), skills: facts?.skills ?? [], team: facts?.team ?? null },
    experience: { min: exp.min, max: exp.max, label: facts?.experienceLabel || expLabel(exp.min, exp.max) },
    location: {
      city,
      region: null,
      workMode: mapWorkMode(job.remote, job.location ?? '', job.description ?? ''),
    },
    eligibility: facts?.eligibility ?? [],
    selectionProcess: (facts?.selectionProcess ?? []).map((s, i) => ({ step: i + 1, label: s.label, detail: s.detail ?? null })),
    dates: [],
    cta: { channel: 'whatsapp' },
    source: { url: job.url, kind: 'pool', poolId: job.id },
  };
  // A row with no rupee figure has no salary the card may print, and says so.
  if (inr.min !== null && inr.max !== null) {
    base.salary = {
      min: Math.round(inr.min / 10_000) / 10,
      max: Math.round(inr.max / 10_000) / 10,
      currency: 'INR',
      unit: 'LPA',
      note: facts?.salaryNote ?? null,
    };
  }
  return base;
}

export type PageFetch = (url: string) => Promise<{ html: string; url: string }>;

const defaultFetch: PageFetch = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'iolar-jobcard/1.0' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return { html: await r.text(), url: r.url || url };
};

/** A job URL read into a document: the page's own markup, the model, then the rules. */
export async function fromUrl(
  url: string,
  opts: { run?: Runner; page?: PageFetch } = {}
): Promise<{ draft: JobCardDraft; logoUrl: string | null }> {
  const { html, url: finalUrl } = await (opts.page ?? defaultFetch)(url);
  const text = stripTags(html);
  const marked = fromJobPosting(jsonLdBlocks(html));
  const facts = opts.run ? await factsFromText(text, opts.run) : null;

  const title = marked.role?.title ?? text.slice(0, 120);
  const exp = mapExperience(title, text);
  const inr = mapSalaryInr(text.match(/[^.]*(?:₹|INR|LPA|lakhs?)[^.]*/i)?.[0] ?? null);

  const rules: JobCardDraft = {
    experience: { min: exp.min, max: exp.max, label: expLabel(exp.min, exp.max) },
    ...(inr.min !== null && inr.max !== null
      ? {
          salary: {
            min: Math.round(inr.min / 10_000) / 10,
            max: Math.round(inr.max / 10_000) / 10,
            currency: 'INR',
            unit: 'LPA',
            note: null,
          },
        }
      : {}),
  };

  const fromModel: JobCardDraft = {
    role: { title: marked.role?.title ?? '', skills: facts?.skills ?? [], team: facts?.team ?? null },
    ...(facts?.experienceLabel
      ? { experience: { min: exp.min, max: exp.max, label: facts.experienceLabel } }
      : {}),
    eligibility: facts?.eligibility ?? [],
    selectionProcess: (facts?.selectionProcess ?? []).map((s, i) => ({ step: i + 1, label: s.label, detail: s.detail ?? null })),
  };

  const draft = merge(rules, marked, fromModel, {
    // The role's title comes from the markup when it has one; the model never renames a job.
    ...(marked.role?.title
      ? { role: { title: marked.role.title, skills: facts?.skills ?? [], team: facts?.team ?? null } }
      : {}),
    cta: { channel: 'whatsapp' },
    source: { url: finalUrl, kind: 'job-url', poolId: null },
  });

  return { draft, logoUrl: findLogo(html, finalUrl) };
}
