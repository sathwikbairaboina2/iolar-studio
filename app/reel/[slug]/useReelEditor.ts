'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reel } from '@/lib/reel/schema';
import type { Log } from '@/lib/reel/history';

/**
 * The studio's client for the command layer.
 *
 * Every edit leaves as a named op and the reel comes back from the server, so
 * the UI has exactly the authority an agent has — no more. Undo lives on the
 * server too, which is what lets one stack cover both actors.
 */
export function useReelEditor(slug: string) {
  const [reel, setReel] = useState<Reel | null>(null);
  const [history, setHistory] = useState<Log>({ cursor: 0, entries: [] });
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    const [r, h] = await Promise.all([
      fetch(`/api/reel/${slug}`).then((x) => x.json()),
      fetch(`/api/reel/${slug}/history`).then((x) => x.json()),
    ]);
    if (!aliveRef.current) return;
    if (r.reel) setReel(r.reel);
    if (h.entries) setHistory(h);
  }, [slug]);

  useEffect(() => {
    aliveRef.current = true;
    // The rule guards against synchronous setState cascades; refresh only sets
    // state after awaiting the server, and aliveRef drops a late unmounted reply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  // The server pushes the reel on every change, from whichever client made it.
  useEffect(() => {
    const source = new EventSource(`/api/reel/${slug}/events`);
    source.onopen = () => setConnected(true);
    source.onmessage = (e: MessageEvent) => {
      setReel(JSON.parse(e.data));
      // The log moved too, but the stream only carries the reel; ask for it.
      fetch(`/api/reel/${slug}/history`)
        .then((x) => x.json())
        .then((h) => h.entries && setHistory(h))
        .catch(() => {});
    };
    // EventSource reconnects on its own; refetch so nothing missed while down is lost.
    source.onerror = () => {
      setConnected(false);
      refresh().catch(() => {});
    };
    return () => source.close();
  }, [slug, refresh]);

  const run = useCallback(
    async (op: string, args: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/reel/${slug}/edit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, args, actor: 'ui' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `${op} failed`);
          return null;
        }
        setReel(data.reel);
        return data.reel as Reel;
      } finally {
        setBusy(false);
      }
    },
    [slug]
  );

  const move = useCallback(
    async (action: 'undo' | 'redo') => {
      setError(null);
      const res = await fetch(`/api/reel/${slug}/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `nothing to ${action}`);
        return;
      }
      setReel(data.reel);
      setHistory((h) => ({ ...h, cursor: data.cursor }));
    },
    [slug]
  );

  const undo = useCallback(() => move('undo'), [move]);
  const redo = useCallback(() => move('redo'), [move]);

  return { reel, setReel, history, error, setError, connected, busy, run, undo, redo, refresh };
}
