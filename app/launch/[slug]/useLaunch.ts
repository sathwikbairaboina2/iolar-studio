'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from '@/lib/ui/message';
import type { LaunchCriticRecord } from '@/lib/launch/rubric';
import type { LaunchProps, ReceiptShot } from '@/lib/launch/edit';
import type { Assets, Brief, Claims, FactCheck, Job, Script } from '@/lib/launch/schema';
import type { Spend } from '@/lib/launch/spend';

/** What GET /api/launch/<slug> returns. */
export type LaunchDetail = {
  slug: string;
  brief: Brief;
  job: Job;
  claims: Claims | null;
  script: Script | null;
  factcheck: FactCheck | null;
  receipts: Record<string, ReceiptShot> | null;
  props: LaunchProps | null;
  spend: Spend | null;
  assets: Assets | null;
  critic: LaunchCriticRecord | null;
  running: boolean;
};

const POLL_MS = 3000;

/** The reel, kept fresh only while a run is going: the poll starts when something is running and stops when nothing is. */
export function useLaunch(slug: string) {
  const [data, setData] = useState<LaunchDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/launch/${slug}`, { cache: 'no-store' });
    if (!alive.current) return null;
    if (r.status === 404) { setMissing(true); return null; }
    if (!r.ok) return null;
    const body = (await r.json()) as LaunchDetail;
    setData(body);
    return body;
  }, [slug]);

  const busy = data ? data.running || Object.values(data.job.stages).some((s) => s.status === 'running') : false;

  useEffect(() => {
    alive.current = true;
    // The first read after mount; the state it sets arrives after the fetch, not during the render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => { void reload(); }, POLL_MS);
    return () => clearInterval(id);
  }, [busy, reload]);

  /** POSTs an action, tells the person if it was refused, and reads the new state. */
  const act = useCallback(async (path: string, body?: unknown, ok?: string) => {
    const r = await fetch(`/api/launch/${slug}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { message.error(out.error ?? 'that did not start'); return false; }
    if (ok) message.success(ok);
    // The job marks its first stage running a moment after the answer; read twice so the poll starts.
    await reload();
    setTimeout(() => { void reload(); }, 800);
    return true;
  }, [slug, reload]);

  return { data, missing, busy, reload, act };
}
