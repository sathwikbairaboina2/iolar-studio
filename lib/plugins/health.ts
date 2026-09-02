import { PLUGINS, type PluginName } from './registry';
import { logPlugin } from './log';

/**
 * What each service says about itself.
 *
 * `up` is "it answered". `ready` is "it can actually do the work", and the two come apart in
 * practice: the lipsync API answered 200 for an hour while it was pointed at a ComfyUI that
 * had none of the video weights. So the sub-checks are carried through to the page rather
 * than collapsed into one dot.
 */

export type { Check, PluginHealth } from './reconcile';
export { reconcile } from './reconcile';
import type { Check, PluginHealth } from './reconcile';

// The lipsync health check pings its Celery worker, which answers slowly while that worker is
// busy rendering — measured at 3.2s mid-render. A tighter budget reports a service as down
// exactly when it is working hardest.
const TIMEOUT_MS = 6000;

async function ask(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.json();
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === 'object' && v !== null ? (v as Rec) : {});

function lipsyncChecks(body: unknown): Check[] {
  const checks = rec(rec(body).checks);
  const out: Check[] = [];
  const redis = rec(checks.redis);
  if (checks.redis) out.push({ label: 'redis', ok: redis.ok === true });
  const worker = rec(checks.worker);
  if (checks.worker) out.push({ label: `worker ${Number(worker.workers ?? 0)}`, ok: worker.ok === true });
  const comfy = rec(checks.comfyui);
  if (checks.comfyui) {
    out.push(
      comfy.ok === true
        ? { label: 'comfyui', ok: true }
        : { label: 'comfyui', ok: false, detail: String(comfy.error ?? 'unreachable').slice(0, 80) }
    );
  }
  const models = rec(checks.models);
  if (checks.models) {
    const missing = Array.isArray(models.missing) ? models.missing.length : 0;
    out.push(models.ok === true ? { label: 'models', ok: true } : { label: 'models', ok: false, detail: `${missing} missing` });
  }
  return out;
}

/**
 * The research service reports its model and each search channel separately. A hunt needs
 * the model and the search engine; a missing yt-dlp only loses one channel, so readiness is
 * those two and the rest are shown for what they are.
 */
function researchChecks(body: unknown): { checks: Check[]; ready: boolean } {
  const ollama = rec(rec(body).ollama);
  const model = String(ollama.model ?? 'ollama');
  const modelOk = ollama.ok === true;
  const checks: Check[] = [
    modelOk
      ? { label: model, ok: true }
      : { label: model, ok: false, detail: String(ollama.recovery ?? 'unreachable').slice(0, 80) },
  ];
  const channels = Array.isArray(rec(body).channels) ? (rec(body).channels as Rec[]) : [];
  let searchOk = false;
  for (const c of channels) {
    const label = String(c.channel ?? 'channel');
    const ok = c.ok === true;
    if (label === 'searxng') searchOk = ok;
    checks.push(c.detail ? { label, ok, detail: String(c.detail).slice(0, 80) } : { label, ok });
  }
  return { checks, ready: modelOk && searchOk };
}

async function probe(p: (typeof PLUGINS)[number]): Promise<PluginHealth> {
  const base: PluginHealth = {
    name: p.name,
    label: p.label,
    port: p.port,
    what: p.what,
    up: false,
    ready: false,
    checks: [],
    startable: Boolean(p.start),
    startHint: p.start?.hint,
    openUrl: p.openUrl,
  };

  try {
    // Qdrant's /healthz is plain text, not JSON; Neo4j's root is a discovery document.
    // Both cards say how much they hold, so an empty graph is visible before an agent notices.
    if (p.name === 'qdrant' || p.name === 'neo4j') {
      const res = await fetch(p.healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      let counts: { nodes: number; passages: number; claims: number };
      try {
        counts = await (await import('@/lib/knowledge/recall')).storeCounts();
      } catch {
        return { ...base, up: true, ready: false, checks: [{ label: 'answering, counts unavailable', ok: false }] };
      }
      const fmt = (n: number) => n.toLocaleString('en-GB');
      if (p.name === 'neo4j') {
        return {
          ...base,
          up: true,
          ready: counts.nodes > 0,
          checks: [
            counts.nodes > 0
              ? { label: `${fmt(counts.nodes)} nodes`, ok: true }
              : { label: '0 nodes', ok: false, detail: 'run npm run reindex:knowledge -- --wipe' },
          ],
        };
      }
      return {
        ...base,
        up: true,
        ready: true,
        checks: [
          { label: `${fmt(counts.passages)} passages`, ok: true },
          { label: `${fmt(counts.claims)} claims`, ok: true },
        ],
      };
    }
    const body = await ask(p.healthUrl);

    if (p.name === 'lipsync') {
      const checks = lipsyncChecks(body);
      return { ...base, up: true, ready: checks.every((c) => c.ok), checks };
    }
    if (p.name === 'comfyui') {
      const system = rec(rec(body).system);
      const devices = Array.isArray(rec(body).devices) ? (rec(body).devices as Rec[]) : [];
      return {
        ...base,
        up: true,
        ready: true,
        version: system.comfyui_version ? String(system.comfyui_version) : undefined,
        device: devices[0]?.name ? String(devices[0].name) : undefined,
        checks: [],
      };
    }
    if (p.name === 'ollama') {
      const models = Array.isArray(rec(body).models) ? (rec(body).models as Rec[]) : [];
      return {
        ...base,
        up: true,
        ready: models.length > 0,
        checks: [{ label: `${models.length} model${models.length === 1 ? '' : 's'}`, ok: models.length > 0 }],
      };
    }
    if (p.name === 'research') {
      return { ...base, up: true, ...researchChecks(body) };
    }
    if (p.name === 'jobsreel') {
      const b = rec(body);
      const weeks = Number(b.weeks ?? 0);
      return {
        ...base,
        up: true,
        ready: b.ok === true,
        checks: [{ label: `${weeks} week${weeks === 1 ? '' : 's'} on disk`, ok: b.ok === true }],
      };
    }
    return { ...base, up: true, ready: true, checks: [{ label: 'idle', ok: true }] };
  } catch (err) {
    return { ...base, error: String(err instanceof Error ? err.message : err).slice(0, 120) };
  }
}

// The last settled state of each service, so a change is a line in the log and a repeat
// is not. A state has to hold for two polls before it counts: the research service's own
// health check takes seconds and now and then crosses the budget, and one timed-out poll
// announced as an outage, then retracted three seconds later, is noise nobody can act on.
type Seen = { up: boolean; ready: boolean };
const g = globalThis as unknown as { __pluginLast?: Map<PluginName, { settled: Seen; pending: Seen | null }> };
const last = (g.__pluginLast ??= new Map());

const same = (a: Seen, b: Seen) => a.up === b.up && a.ready === b.ready;

function noteFlips(now: PluginHealth[]): void {
  for (const p of now) {
    const seen: Seen = { up: p.up, ready: p.ready };
    const rec = last.get(p.name);
    if (!rec) {
      last.set(p.name, { settled: seen, pending: null });
      continue;
    }
    if (same(rec.settled, seen)) {
      rec.pending = null;
      continue;
    }
    if (!rec.pending || !same(rec.pending, seen)) {
      rec.pending = seen;
      continue;
    }
    const prev = rec.settled;
    rec.settled = seen;
    rec.pending = null;
    if (prev.up && !p.up) {
      logPlugin(p.name, `${p.label} went down on :${p.port}${p.error ? ` (${p.error})` : ''}`, 'error');
    } else if (!prev.up && p.up) {
      logPlugin(p.name, `${p.label} is up on :${p.port}${p.ready ? '' : ', not ready yet'}`, 'success');
    } else if (p.up && prev.ready !== p.ready) {
      const failing = p.checks.filter((c) => !c.ok).map((c) => c.label).join(', ');
      logPlugin(
        p.name,
        p.ready ? `${p.label} is ready` : `${p.label} is not ready: ${failing || 'a check failed'}`,
        p.ready ? 'success' : 'warning'
      );
    }
  }
}

/** Every service, asked at once — a slow one must not hold up the rest of the page. */
export async function readHealth(): Promise<PluginHealth[]> {
  const now = await Promise.all(PLUGINS.map(probe));
  noteFlips(now);
  return now;
}

