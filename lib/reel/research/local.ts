import type { Brief } from './brief';
import type { SearchPlan } from './plan';
import type { TraceEvent } from './trace';

/**
 * The hunt, done by the research service instead of by Claude.
 *
 * The service is the research plugin's backend: a local model driving SearXNG, a page
 * reader, yt-dlp and the GitHub CLI, keeping everything it reads in a library. Nothing
 * leaves the machine and nobody is billed. It takes one question and returns a cited
 * report plus the list of sources it actually fetched — and, while it runs, a step log of
 * every search and read, which is exactly the trace the panel wants to show.
 *
 * It is slower than Claude's subagents (a 27B model, ten to twenty minutes) and it takes
 * one question rather than a query list, so the approved plan is folded into the question:
 * the claims to prove, the queries to try, the places to look. Its own log shows what it
 * made of that.
 */

export type LocalRunStep = { at?: string; tool?: string; kind?: string; input?: unknown; text?: string; url?: string; query?: string };
export type LocalRun = {
  research: { status: string; reportMd?: string | null; stopReason?: string | null };
  steps: LocalRunStep[];
  sources: { title: string; url: string; channel?: string }[];
};

export type LocalOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
  /** Called with each step the service logs, once, as it appears. */
  onStep?: (event: Omit<TraceEvent, 'at' | 'stage'>) => void;
};

/** The one question the service gets, carrying the whole approved plan. */
export function composeQuestion(brief: Brief, plan: SearchPlan): string {
  const queries = plan.queries.map((q) => `- [${q.class}] ${q.query}  (to prove: ${q.proves})`).join('\n');
  return [
    `Research for a short video. Angle: ${brief.angle}`,
    `Audience: ${brief.audience}.`,
    `Claims the sources must prove:`,
    ...brief.mustProve.map((c) => `- ${c}`),
    brief.avoid.length ? `Avoid this framing: ${brief.avoid.join('; ')}.` : '',
    `Nothing older than ${brief.recencyWindowDays} days unless foundational.`,
    `Approach: ${plan.approach}`,
    `Run these searches, then read the primary sources they surface:`,
    queries,
    `Report each claim with the source that proves it.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A step from the service's log as a trace event. The service's step shape is loose —
 * different channels log different fields — so this reads whichever of them is there.
 */
export function stepToTrace(step: LocalRunStep): Omit<TraceEvent, 'at' | 'stage'> | null {
  const tool = String(step.tool ?? step.kind ?? '').toLowerCase();
  const input = (step.input ?? {}) as Record<string, unknown>;
  const query = step.query ?? (typeof input.query === 'string' ? input.query : undefined);
  const url = step.url ?? (typeof input.url === 'string' ? input.url : undefined);
  if (query && /search/.test(tool)) return { kind: 'search', text: query };
  if (url) return { kind: 'read', text: step.text || url, url };
  if (query) return { kind: 'search', text: query };
  if (step.text) return { kind: 'note', text: step.text };
  return null;
}

/** The service's source list, in the shape the critic reads a hunt in. */
export function sourcesToHunt(
  sources: LocalRun['sources'],
  brief: Brief
): Record<string, unknown>[] {
  const classOf = (url: string, channel?: string): Brief['sourceClasses'][number] => {
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    if (/youtube\.com|youtu\.be/.test(host) || channel === 'youtube') return 'youtube';
    if (/github\.com/.test(host) || channel === 'github') return 'github';
    if (/twitter\.com|x\.com/.test(host)) return 'x';
    if (/docs\.|readthedocs|\/docs\//.test(url)) return 'docs';
    if (brief.sourceClasses.includes('news') && /news|reuters|bbc|nytimes|theverge|arstechnica|wired/.test(host)) return 'news';
    return brief.sourceClasses.includes('blog') ? 'blog' : brief.sourceClasses[0];
  };

  return sources.map((s) => {
    let publisher = '';
    try {
      publisher = new URL(s.url).hostname.replace(/^www\./, '');
    } catch {
      publisher = s.channel ?? 'unknown';
    }
    return {
      class: classOf(s.url, s.channel),
      url: s.url,
      title: s.title,
      publisher,
      author: null,
      publishedAt: null,
      summary: '',
      pullQuotes: [],
      stats: [],
      assetKind: 'doc',
      whyItMatters: 'read by the local research run; the critic judges it against the brief',
    };
  });
}

async function api<T>(baseUrl: string, fetchImpl: typeof fetch, path: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, init);
  const text = await res.text();
  let body: T & { error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`research service ${path} returned non-JSON (${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok || body.error) throw new Error(`research service ${path} failed (${res.status}): ${body.error ?? text.slice(0, 160)}`);
  return body;
}

export async function localHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  try {
    const h = await api<{ ollama: { ok: boolean; model: string; recovery?: string }; channels: { channel: string; ok: boolean }[] }>(
      baseUrl,
      fetchImpl,
      '/api/health'
    );
    const down = h.channels.filter((c) => !c.ok).map((c) => c.channel);
    if (!h.ollama.ok) return { ok: false, detail: `model ${h.ollama.model} unreachable — ${h.ollama.recovery ?? 'start ollama'}` };
    if (down.includes('searxng')) return { ok: false, detail: 'searxng is down, so the service cannot search' };
    return { ok: true, detail: `${h.ollama.model}${down.length ? ` (down: ${down.join(', ')})` : ''}` };
  } catch (err) {
    return { ok: false, detail: String(err instanceof Error ? err.message : err) };
  }
}

/**
 * Runs one research job on the service and returns its findings as a hunt.
 *
 * Steps are relayed as they appear, each once. A run that ends on anything other than
 * `finish` still yields its sources — a partial pack is judged like any other — but the
 * reason is passed on as a note so the panel can say the run was cut short.
 */
export async function huntLocally(brief: Brief, plan: SearchPlan, opts: LocalOptions): Promise<Record<string, unknown>[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 25 * 60 * 1000;

  const health = await localHealth(opts.baseUrl, fetchImpl);
  if (!health.ok) throw new Error(`research service not ready: ${health.detail}`);

  const { id } = await api<{ id: string }>(opts.baseUrl, fetchImpl, '/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: composeQuestion(brief, plan) }),
  });
  opts.onStep?.({ kind: 'note', text: `research service run ${id} started` });

  const started = Date.now();
  let seen = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const d = await api<LocalRun>(opts.baseUrl, fetchImpl, `/api/research/${id}`);
    for (const step of d.steps.slice(seen)) {
      const ev = stepToTrace(step);
      if (ev) opts.onStep?.(ev);
    }
    seen = d.steps.length;
    if (d.research.status !== 'running') {
      if (d.research.stopReason && d.research.stopReason !== 'finish') {
        opts.onStep?.({ kind: 'note', text: `run ended on ${d.research.stopReason}: the pack is partial` });
      }
      return sourcesToHunt(d.sources, brief);
    }
  }
  throw new Error(`research service run ${id} still going after ${Math.round(timeoutMs / 60000)} minutes`);
}
