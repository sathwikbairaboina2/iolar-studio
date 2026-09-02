import type { PluginName } from './registry';

/**
 * The health report's shape and the one pure correction the page applies to it. This
 * module has no server imports on purpose: the Plugins page is a client component and
 * bundles whatever it touches, and health.ts reaches settings and the knowledge stores.
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
