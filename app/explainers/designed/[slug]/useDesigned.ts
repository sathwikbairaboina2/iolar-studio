'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from '@/lib/ui/message';
import type { CriticRecord } from '@/lib/explainer2/critic';
import type { Brief, FactCheck, Job, Script, Timing } from '@/lib/explainer2/schema';

/** What GET /api/explainers2/<slug> returns. */
export type Detail = {
  slug: string;
  brief: Brief;
  job: Job;
  script: Script | null;
  factcheck: FactCheck | null;
  timing: Timing | null;
  stills: string[];
  voice: string[];
  /** The last critique (scores out of 10 and the fixes), or null before it has run. */
  critic: CriticRecord | null;
  /** The motion strips the critic looked at (b1.png, ...). */
  strips: string[];
  /** The music bed chosen for the video and the beds the audio library offers. */
  sound: { bed: string | null; beds: { file: string; mood: string | null }[] };
  running: boolean;
};

const POLL_MS = 3000;

/** The explainer, kept fresh only while a run is going: the poll starts when something is running and stops when nothing is. */
export function useDesigned(slug: string) {
  const [data, setData] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/explainers2/${slug}`, { cache: 'no-store' });
    if (!alive.current) return null;
    if (r.status === 404) { setMissing(true); return null; }
    if (!r.ok) return null;
    const body = (await r.json()) as Detail;
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
    const r = await fetch(`/api/explainers2/${slug}/${path}`, {
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

  const saveScript = useCallback(async (script: Script) => {
    const r = await fetch(`/api/explainers2/${slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(script) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { message.error(out.error ?? 'it would not save'); return false; }
    message.success('script saved; the fact check will run again');
    await reload();
    return true;
  }, [slug, reload]);

  return { data, missing, busy, reload, act, saveScript };
}
