'use client';
import { useEffect, useRef } from 'react';
import { notification } from 'antd';
import type { LogEntry } from '@/lib/plugins/log';

/**
 * Shows what the plugins are doing, wherever you are in the studio.
 *
 * A render yielding the GPU, a service starting, a renderer going down: these happen on
 * the server and used to be invisible. This polls the activity log and raises each new
 * line as a notification, so a shot that waits on an unload says so on screen.
 */

const POLL_MS = 3000;

export default function PluginActivity() {
  const since = useRef<number | null>(null);
  // The hook form, not the static one: the static notification cannot see the theme.
  const [api, contextHolder] = notification.useNotification({ placement: 'bottomRight' });

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const q = since.current === null ? '' : `?since=${since.current}`;
        const r = await fetch(`/api/plugins/log${q}`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = (await r.json()) as { entries: LogEntry[]; last: number };
        if (stopped) return;
        // The first poll only learns where the log is; history is the Plugins page's job.
        if (since.current !== null) {
          for (const e of d.entries) {
            api[e.level]({
              key: `plugin-${e.id}`,
              title: e.plugin,
              description: e.text,
              duration: e.level === 'error' ? 0 : 6,
            });
          }
        }
        since.current = d.last;
      } catch {
        // The studio may be restarting; the next tick tries again.
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [api]);

  return contextHolder;
}
