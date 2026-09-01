import { PLUGINS, type PluginName } from './registry';

/**
 * What each service says about itself.
 *
 * `up` is "it answered". `ready` is "it can actually do the work", and the two come apart in
 * practice: the lipsync API answered 200 for an hour while it was pointed at a ComfyUI that
 * had none of the video weights. So the sub-checks are carried through to the page rather
 * than collapsed into one dot.
 */

export type Check = { label: string; ok: boolean; detail?: string };

export type PluginHealth = {
  name: PluginName;
  label: string;
  port: number;
  what: string;
  up: boolean;
  ready: boolean;
  checks: Check[];
  version?: string;
  device?: string;
  error?: string;
  startable: boolean;
  startHint?: string;
  openUrl?: string;
};

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
    return { ...base, up: true, ready: true, checks: [{ label: 'idle', ok: true }] };
  } catch (err) {
    return { ...base, error: String(err instanceof Error ? err.message : err).slice(0, 120) };
  }
}

/** Every service, asked at once — a slow one must not hold up the rest of the page. */
export async function readHealth(): Promise<PluginHealth[]> {
  return Promise.all(PLUGINS.map(probe));
}

/**
 * Corrects a health report against what the studio can see happening.
 *
 * Celery answers its ping slowly enough under a solo-pool render that the lipsync API
 * reports zero workers while one is mid-shot. A page that believed that would send you to
 * restart a service that is working — so a render in flight is taken as proof of a worker.
 */
export function reconcile(
  plugins: PluginHealth[],
  jobs: { plugin: string; status: string }[]
): PluginHealth[] {
  const busy = new Set(jobs.filter((j) => j.status === 'running').map((j) => j.plugin));
  return plugins.map((p) => {
    if (!busy.has(p.name) || !p.up) return p;
    const checks = p.checks.map((c) =>
      c.label.startsWith('worker') && !c.ok ? { label: 'worker busy', ok: true } : c
    );
    return { ...p, checks, ready: checks.every((c) => c.ok) };
  });
}
