'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd';

/**
 * What one renderer is doing, and why anything it produced is not usable.
 *
 * Two boards rather than one list of assets: a page visit and a lipsync render
 * fail in different ways and are worth watching for different reasons. A page
 * job is seconds and its own review pass can reject the result; a presenter job
 * is minutes on a 14B model and what matters is where it sits in the queue.
 *
 * Retry is per row on purpose. One bad shot in twelve should cost one shot.
 */

export type Job = {
  assetId: string;
  beatId: string;
  status: string;
  jobId?: string;
  error?: string;
  brief: string;
  durationSec?: number;
  /** Pages only: where it went and what the marker swept. */
  url?: string;
  highlight?: string;
  /** Pages only: what the plugin's own review pass said. */
  review?: { ok: boolean; notes: string } | null;
};

const COLOUR: Record<string, string> = {
  ready: 'green',
  running: 'blue',
  queued: 'default',
  failed: 'red',
  'awaiting-manual': 'orange',
};

export default function JobsBoard({
  slug,
  provider,
  title,
  empty,
  extraColumns = [],
}: {
  slug: string;
  provider: 'webpage' | 'lipsync';
  title: string;
  empty: string;
  extraColumns?: { title: string; render: (job: Job) => React.ReactNode; width?: number }[];
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<{ running: number; queued: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/jobs?provider=${provider}`);
    if (!r.ok) return;
    const body = await r.json();
    setJobs(body.jobs ?? []);
    setQueue(body.queue ?? null);
  }, [slug, provider]);

  useEffect(() => {
    load();
    // Cheap: the route reads the reel and asks the plugin, both local.
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const retry = async (beatId: string) => {
    setBusy(beatId);
    setError(null);
    try {
      const r = await fetch(`/api/reel/${slug}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beatId }),
      });
      if (!r.ok) setError((await r.json()).error ?? 'retry failed');
    } finally {
      setBusy(null);
      await load();
    }
  };

  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="small">
      <Space>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text type="secondary">
          {jobs.length} shot{jobs.length === 1 ? '' : 's'}
          {waiting ? ` · ${waiting} in flight` : ''}
        </Typography.Text>
        {queue && (
          <Tooltip title="What the renderer itself has on its plate, across every reel">
            <Tag>{queue.running} running · {queue.queued} queued</Tag>
          </Tooltip>
        )}
      </Space>

      {error && <Alert type="error" showIcon title={error} closable onClose={() => setError(null)} />}

      {jobs.length === 0 ? (
        <Empty description={empty} />
      ) : (
        <Table
          size="small"
          pagination={false}
          rowKey="assetId"
          dataSource={jobs}
          columns={[
            { title: 'Beat', dataIndex: 'beatId', width: 60 },
            {
              title: 'State',
              dataIndex: 'status',
              width: 130,
              render: (s: string) => <Tag color={COLOUR[s]}>{s}</Tag>,
            },
            ...extraColumns.map((c) => ({ title: c.title, width: c.width, render: (_: unknown, j: Job) => c.render(j) })),
            {
              title: 'Why not',
              render: (_: unknown, j: Job) =>
                j.error ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{j.error}</Typography.Text>
                ) : null,
            },
            {
              title: '',
              width: 80,
              render: (_: unknown, j: Job) =>
                j.status === 'failed' || j.status === 'awaiting-manual' ? (
                  <Button size="small" loading={busy === j.beatId} onClick={() => retry(j.beatId)}>
                    Retry
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </Space>
  );
}
