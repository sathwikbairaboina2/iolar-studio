'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from '@/lib/ui/message';
import type { ExplainerDoc, Scene } from '@/lib/explainer/schema';
import type { FitReport } from '@/lib/explainer/fit';

export type Step = {
  id: string; role: string; startFrame: number; durationFrames: number; mutations: number; scene: Scene;
};
export type Loaded = {
  slug: string;
  doc: ExplainerDoc;
  seconds: number | null;
  steps: Step[];
  foldError: { beatId: string; message: string } | null;
  /** Computed on the read, because the route folded the document to answer anyway. */
  fit: FitReport | null;
};
export type Entry = { seq: number; op: string; actor: 'ui' | 'agent'; at: string; summary: string };
export type Log = { cursor: number; entries: Entry[] };

/**
 * One way in and out of an explainer for the editor.
 *
 * Mirrors useReelEditor: every edit goes through `run`, which is the same door an agent uses, so
 * the two cannot drift. Responses carry the folded board, so the page never refetches to redraw.
 */
export function useExplainerEditor(slug: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [log, setLog] = useState<Log>({ cursor: 0, entries: [] });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const [d, l] = await Promise.all([
      fetch(`/api/explainers/${slug}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/explainers/${slug}/history`, { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (!alive.current) return;
    setData(d);
    setLog(l);
  }, [slug]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  /** Every edit, from the studio, labelled as the studio. */
  const run = useCallback(async (op: string, args: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, args, actor: 'ui' }),
      });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.beatId ? `${body.beatId}: ${body.error}` : (body.error ?? 'that edit was refused'));
        return false;
      }
      await reload();
      return true;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [slug, reload]);

  const move = useCallback(async (dir: 'undo' | 'redo') => {
    setBusy(true);
    try {
      const r = await fetch(`/api/explainers/${slug}/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ move: dir }),
      });
      const body = await r.json();
      if (!r.ok) { message.info(body.error ?? `nothing to ${dir}`); return; }
      await reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [slug, reload]);

  return { data, log, busy, run, move, reload };
}
