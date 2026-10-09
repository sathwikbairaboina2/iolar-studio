'use client';
import { useCallback, useEffect, useState } from 'react';
import type { PublishState } from '@/lib/publish/state';
import type { PublishJob } from '@/lib/publish/job';

export type PublishData = {
  state: PublishState;
  job: PublishJob | null;
  queue: { chapters: string[]; order: boolean };
  live: string[];
  stale: string[];
};

/** The publish snapshot for a subject, refreshed every 1.5 s only while a run is live. */
export function usePublish(subject: string) {
  const [data, setData] = useState<PublishData | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch(`/api/handbooks/${subject}/publish`)).json();
      if (d && d.state) setData(d as PublishData);
    } catch { /* the studio keeps working without the publish panel */ }
  }, [subject]);

  useEffect(() => {
    let gone = false;
    fetch(`/api/handbooks/${subject}/publish`).then((r) => r.json()).then((d) => { if (!gone && d?.state) setData(d as PublishData); }).catch(() => {});
    return () => { gone = true; };
  }, [subject]);

  const running = !!data?.job?.live;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  /** Sends one action and refreshes; throws the server's message on a refusal. */
  const act = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/handbooks/${subject}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? 'failed');
    await load();
    return d;
  }, [subject, load]);

  return { data, load, act };
}
