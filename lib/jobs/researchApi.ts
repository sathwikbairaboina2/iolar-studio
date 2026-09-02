import { getSettings } from '@/lib/settings';

/**
 * The studio's client for research-plugin's jobs mode on :25100. Parameter names come
 * from its src/lib/jobs/query.ts on 2 September 2026: category, q, company, since,
 * remote=1, tech (tech-only is the default; tech=0 sees everything), includeClosed=1,
 * limit, offset, group=1. The brief endpoint reads the same parameters.
 */

export type PoolCategory = 'india' | 'global-remote' | 'other' | 'all';
export type PoolFilter = { category: PoolCategory; techOnly: boolean; q?: string };

export type ResearchJob = {
  id: number;
  sourceId: number;
  sourceLabel: string;
  provider: string;
  url: string;
  title: string;
  company: string;
  location: string;
  category: 'india' | 'global-remote' | 'other';
  remote: boolean;
  employment: string | null;
  salary: string | null;
  tags: string[];
  description: string;
  postedAt: string | null;
  isTech: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  familyKey: string;
  locationCount: number;
  locations: string[];
};

export type ResearchOpts = { baseUrl?: string; fetchImpl?: typeof fetch };

export class ResearchDown extends Error {}

const TIMEOUT_MS = 30_000;

export const researchBase = (opts: ResearchOpts = {}) => (opts.baseUrl ?? getSettings().researchUrl).replace(/\/$/, '');

export function filterParams(filter: PoolFilter): URLSearchParams {
  const p = new URLSearchParams();
  p.set('category', filter.category);
  p.set('tech', filter.techOnly ? '1' : '0');
  if (filter.q) p.set('q', filter.q);
  return p;
}

export function defaultFilter(): PoolFilter {
  const s = getSettings();
  return { category: s.jobsCategory, techOnly: s.jobsTechOnly };
}

async function call(url: string, init: RequestInit, opts: ResearchOpts): Promise<Response> {
  const http = opts.fetchImpl ?? fetch;
  try {
    return await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ResearchDown(`research-plugin is not answering on ${researchBase(opts)}: ${String(err instanceof Error ? err.message : err)}`);
  }
}

/** One page of the pool, grouped one row per posting family. */
export async function listPool(
  filter: PoolFilter,
  page: { limit: number; offset: number },
  opts: ResearchOpts = {}
): Promise<{ total: number; items: ResearchJob[] }> {
  const p = filterParams(filter);
  p.set('group', '1');
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  const res = await call(`${researchBase(opts)}/api/jobs?${p}`, { cache: 'no-store' }, opts);
  if (!res.ok) throw new ResearchDown(`research-plugin answered ${res.status} for the pool`);
  const body = (await res.json()) as { total?: number; items?: ResearchJob[] };
  return { total: Number(body.total ?? 0), items: Array.isArray(body.items) ? body.items : [] };
}

/** The markdown brief for the same slice. Empty when the endpoint fails; a brief is nice, not needed. */
export async function briefFor(filter: PoolFilter, opts: ResearchOpts = {}): Promise<string> {
  try {
    const p = filterParams(filter);
    p.set('group', '1');
    const res = await call(`${researchBase(opts)}/api/jobs/brief?${p}`, { method: 'POST' }, opts);
    if (!res.ok) return '';
    const body = (await res.json()) as { brief?: string; markdown?: string; text?: string };
    return String(body.brief ?? body.markdown ?? body.text ?? '');
  } catch {
    return '';
  }
}

export async function sourcesHealth(opts: ResearchOpts = {}): Promise<{ enabled: number; total: number; lastError: string | null }> {
  const res = await call(`${researchBase(opts)}/api/jobs/sources`, { cache: 'no-store' }, opts);
  if (!res.ok) throw new ResearchDown(`research-plugin answered ${res.status} for sources`);
  const body = (await res.json()) as { sources?: { enabled: boolean; lastError: string | null }[] };
  const sources = body.sources ?? [];
  return {
    enabled: sources.filter((s) => s.enabled).length,
    total: sources.length,
    lastError: sources.find((s) => s.lastError)?.lastError ?? null,
  };
}
