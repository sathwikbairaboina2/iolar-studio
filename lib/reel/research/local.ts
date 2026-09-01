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

/** One row of the service's `steps` table: a tool call, its arguments as JSON text. */
export type LocalRunStep = {
  seq?: number;
  kind?: string;
  tool?: string | null;
  args_json?: string | null;
  status?: string;
  error?: string | null;
};
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
 * A step from the service's log as a trace event.
 *
 * The service names its tools by channel — `search_web`, `youtube_search`, `github_search`
 * all search; `read_url`, `youtube_transcript`, `github_read` all read — and keeps the
 * arguments as JSON text. A step that failed says so, because a reader should know the
 * page the hunter tried to open and could not.
 */
export function stepToTrace(step: LocalRunStep): Omit<TraceEvent, 'at' | 'stage'> | null {
  const tool = String(step.tool ?? '').toLowerCase();
  let args: Record<string, unknown> = {};
  try {
    args = step.args_json ? (JSON.parse(step.args_json) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
  const failed = step.status === 'error' ? ` (failed: ${step.error ?? 'unknown'})` : '';

  if (/search/.test(tool) && str('query')) {
    const where = tool === 'youtube_search' ? 'youtube: ' : tool === 'github_search' ? 'github: ' : '';
    return { kind: 'search', text: `${where}${str('query')}${failed}` };
  }
  if (tool === 'github_read' && str('repo')) {
    const url = `https://github.com/${str('repo')}/blob/HEAD/${str('path')}`;
    return { kind: 'read', text: `github.com/${str('repo')}/${str('path')}${failed}`, url };
  }
  if (str('url')) {
    const where = str('url').replace(/^https?:\/\/(www\.)?/, '').slice(0, 90);
    return { kind: 'read', text: `${where}${failed}`, url: str('url') };
  }
  if (tool === 'finish') return { kind: 'note', text: 'wrote the report' };
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

  // The plan travels twice: folded into the question for a service that only reads
  // that, and as its own field for one that turns it into the run's opening directive.
  const { id } = await api<{ id: string }>(opts.baseUrl, fetchImpl, '/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: composeQuestion(brief, plan),
      plan: { approach: plan.approach, queries: plan.queries },
    }),
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
