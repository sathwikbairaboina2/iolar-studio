'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from '@/lib/ui/message';
import type { RenderLog, RenderRecord } from '@/lib/explainer/renders';

/**
 * The render log, kept fresh only while something is actually running.
 *
 * A hook that polls a finished job forever is how a laptop gets warm for no reason: the interval
 * is created when a job goes live and cleared the moment none is.
 */

const POLL_MS = 1500;
const EMPTY: RenderLog = { renders: [], live: false, currentHash: '' };

export type { RenderRecord };

export function useExplainerRenders(slug: string) {
  const [log, setLog] = useState<RenderLog>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/explainers/${slug}/render`, { cache: 'no-store' });
    if (!r.ok || !alive.current) return;
    setLog(await r.json());
  }, [slug]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!log.live) return undefined;
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [log.live, refresh]);

  /** Submit and come straight back; the poll above takes it from there. */
  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/render`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.error ?? 'the render was refused');
        return false;
      }
      message.success('rendering');
      await refresh();
      return true;
    } finally {
      if (alive.current) setSubmitting(false);
    }
  }, [slug, refresh]);

  /** Stop one that is still running. The service drops it; the record says it was stopped here. */
  const stop = useCallback(async (id: string) => {
    const r = await fetch(`/api/explainers/${slug}/render`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const body = await r.json();
    if (!r.ok) { message.error(body.error ?? 'it would not stop'); return; }
    if (alive.current) setLog(body);
  }, [slug]);

  return { log, submitting, submit, stop, refresh };
}
