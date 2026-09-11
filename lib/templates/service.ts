import { promises as fs } from 'fs';
import path from 'path';

/**
 * The reels templates service (main-reels-templates-plugin, FastAPI on 26200): one JSON
 * document in, one mp4 out. This is the whole of what the studio knows about it. Names,
 * themes, limits and default seconds are read from it, never restated here.
 */

export type TemplateInfo = {
  name: string;
  displayName: string;
  sections: string[];
  required: string[];
  defaults: Record<string, number>;
  limits: Record<string, number>;
  themes: string[];
  samples: Record<string, unknown>;
};
export type ServiceJobState = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed';
export type ServiceJob = { id: string; state: ServiceJobState; progress: number; error: string | null; timeline: unknown | null };
export type ValidationIssue = { loc: (string | number)[]; msg: string };
export type ServiceOpts = { baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number };

export class ServiceDown extends Error {}
export class ServiceRejected extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.loc.join('.')}: ${i.msg}`).join('; ') || 'the service rejected the document');
    this.name = 'ServiceRejected';
  }
}

export const templatesBase = (): string => (process.env.REELS_TEMPLATES_URL ?? 'http://127.0.0.1:26200').replace(/\/$/, '');

const READ_MS = 8000;
const WRITE_MS = 30_000;

function client(opts: ServiceOpts) {
  return { base: (opts.baseUrl ?? templatesBase()).replace(/\/$/, ''), http: opts.fetchImpl ?? fetch, now: opts.now ?? Date.now };
}

async function call(pathname: string, init: RequestInit & { timeoutMs: number }, opts: ServiceOpts): Promise<Response> {
  const { base, http } = client(opts);
  const { timeoutMs, ...rest } = init;
  try {
    return await http(`${base}${pathname}`, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  } catch (err) {
    throw new ServiceDown(`reels-templates is not answering on ${base}: ${String(err instanceof Error ? err.message : err)}; start it from Plugins`);
  }
}

/** FastAPI's 422 shape; the leading "body" segment is the request, not the document. */
function issuesOf(body: unknown): ValidationIssue[] {
  const detail = (body as { detail?: unknown })?.detail;
  if (!Array.isArray(detail)) return [{ loc: [], msg: typeof detail === 'string' ? detail : 'invalid document' }];
  return detail.map((d: { loc?: unknown; msg?: unknown }) => {
    const loc = Array.isArray(d.loc) ? (d.loc as (string | number)[]) : [];
    return { loc: loc[0] === 'body' ? loc.slice(1) : loc, msg: String(d.msg ?? 'invalid') };
  });
}

const cache = new Map<string, { at: number; templates: TemplateInfo[] }>();
const CACHE_MS = 60_000;

export async function templates(opts: ServiceOpts = {}): Promise<TemplateInfo[]> {
  const { base, now } = client(opts);
  const hit = cache.get(base);
  if (hit && now() - hit.at < CACHE_MS) return hit.templates;
  const res = await call('/templates', { timeoutMs: READ_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for /templates`);
  const body = (await res.json()) as { templates?: TemplateInfo[] };
  const list = body.templates ?? [];
  cache.set(base, { at: now(), templates: list });
  return list;
}

export async function validate(doc: unknown, opts: ServiceOpts = {}): Promise<unknown> {
  const res = await call('/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc), timeoutMs: WRITE_MS }, opts);
  if (res.status === 422) throw new ServiceRejected(issuesOf(await res.json().catch(() => ({}))));
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for /validate`);
  return res.json();
}

export async function submit(doc: unknown, opts: ServiceOpts = {}): Promise<{ id: string }> {
  const res = await call('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc), timeoutMs: WRITE_MS }, opts);
  const body = (await res.json().catch(() => ({}))) as { id?: string; missing?: string[] };
  if (res.status === 422) throw new ServiceRejected(issuesOf(body));
  if (res.status === 503) throw new ServiceDown(`reels-templates is missing tools: ${(body.missing ?? []).join(', ')}`);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for POST /jobs`);
  return { id: String(body.id ?? '') };
}

export async function job(id: string, opts: ServiceOpts = {}): Promise<ServiceJob> {
  const res = await call(`/jobs/${encodeURIComponent(id)}`, { timeoutMs: READ_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for job ${id}`);
  const b = (await res.json()) as Partial<ServiceJob>;
  return { id, state: (b.state ?? 'failed') as ServiceJobState, progress: Number(b.progress ?? 0), error: b.error ?? null, timeline: b.timeline ?? null };
}

/** Cancel a running job and forget it. The service answers 404 for a job it has already dropped. */
export async function cancel(id: string, opts: ServiceOpts = {}): Promise<void> {
  const res = await call(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: READ_MS }, opts);
  if (!res.ok && res.status !== 404) throw new ServiceDown(`reels-templates answered ${res.status} cancelling job ${id}`);
}

export async function log(id: string, opts: ServiceOpts = {}): Promise<string> {
  const res = await call(`/jobs/${encodeURIComponent(id)}/log`, { timeoutMs: READ_MS }, opts);
  return res.ok ? res.text() : '';
}

export async function download(id: string, dest: string, opts: ServiceOpts = {}): Promise<void> {
  const res = await call(`/jobs/${encodeURIComponent(id)}/reel.mp4`, { timeoutMs: WRITE_MS }, opts);
  if (!res.ok) throw new ServiceDown(`reels-templates answered ${res.status} for the reel of job ${id}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** The service's own player page: the real composition with a scrubber, no encode. */
export function previewUrl(name: string, theme: string, jobId?: string, base = templatesBase()): string {
  const url = `${base}/preview/${encodeURIComponent(name)}/${encodeURIComponent(theme)}`;
  return jobId ? `${url}?job=${encodeURIComponent(jobId)}` : url;
}
