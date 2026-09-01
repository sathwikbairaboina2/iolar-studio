'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Empty, Segmented, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CaretRightOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import type { PluginHealth } from '@/lib/plugins/health';
import type { JobBoard, JobRow } from '@/lib/plugins/jobs';

/**
 * The control room.
 *
 * Two questions the studio could not answer before: is every renderer up, and what is the GPU
 * doing right now. The GPU renders one shot at a time, so the job on air gets its own line
 * rather than a tile in a grid that would imply parallelism this machine does not have.
 */

const REFRESH_MS = 3000;

const STATUS_COLOUR: Record<JobRow['status'], string> = {
  running: 'orange',
  queued: 'default',
  ready: 'green',
  failed: 'red',
  'awaiting-manual': 'gold',
};

export default function PluginsPage() {
  const router = useRouter();
  const [plugins, setPlugins] = useState<PluginHealth[] | null>(null);
  const [board, setBoard] = useState<JobBoard | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  // Most rows on this machine are shots that landed weeks ago. The board is for what is
  // moving or stuck, so that is what it opens on.
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [h, j] = await Promise.all([
      fetch('/api/plugins').then((r) => r.json()).catch(() => null),
      fetch('/api/plugins/jobs').then((r) => r.json()).catch(() => null),
    ]);
    if (Array.isArray(h?.plugins)) setPlugins(h.plugins as PluginHealth[]);
    if (Array.isArray(j?.rows)) setBoard(j as JobBoard);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const start = async (name: string, label: string) => {
    setStarting(name);
    try {
      const r = await fetch(`/api/plugins/${name}/start`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'it would not start');
      message.success(`starting ${label} — it takes a few seconds to answer`);
    } catch (err) {
      message.error(String(err));
    } finally {
      setStarting(null);
      setTimeout(refresh, 4000);
    }
  };

  const retry = async (row: JobRow) => {
    const key = `${row.slug}:${row.beatId}`;
    setRetrying(key);
    try {
      const r = await fetch(`/api/reel/${row.slug}/shots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beatId: row.beatId, action: 'retry' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'it would not queue');
      message.success(`queued ${row.beatId} again`);
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setRetrying(null);
    }
  };

  const ACTIVE = new Set(['running', 'queued', 'failed', 'awaiting-manual']);
  const rows = (board?.rows ?? []).filter((r) => scope === 'all' || ACTIVE.has(r.status));
  const onAir = board?.rows.find((r) => r.status === 'running');
  const waiting = board?.rows.filter((r) => r.status === 'queued') ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          Plugins
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          refreshes every {REFRESH_MS / 1000}s
        </Typography.Text>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 16, alignItems: 'start' }}>
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          {(plugins ?? []).map((p) => (
            <Card
              key={p.name}
              size="small"
              data-testid={`plugin-${p.name}`}
              title={
                <Space>
                  <Badge status={!p.up ? 'error' : p.ready ? 'success' : 'warning'} />
                  <span>{p.label}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    :{p.port}
                  </Typography.Text>
                </Space>
              }
              extra={
                p.up ? (
                  p.openUrl ? (
                    <a href={p.openUrl} target="_blank" rel="noreferrer">
                      <ExportOutlined />
                    </a>
                  ) : null
                ) : p.startable ? (
                  <Tooltip title={`Runs ${p.startHint}`}>
                    <Button
                      data-testid={`plugin-start-${p.name}`}
                      size="small"
                      type="primary"
                      icon={<CaretRightOutlined />}
                      loading={starting === p.name}
                      onClick={() => start(p.name, p.label)}
                    >
                      Start
                    </Button>
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    start it yourself
                  </Typography.Text>
                )
              }
            >
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                {p.what}
              </Typography.Paragraph>
              <Space wrap size={[4, 4]}>
                {p.checks.map((c) => (
                  <Tooltip key={c.label} title={c.detail}>
                    <Tag color={c.ok ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ''}
                    </Tag>
                  </Tooltip>
                ))}
                {p.version && <Tag>{p.version}</Tag>}
                {!p.up && <Tag color="red">{p.error ?? 'no answer'}</Tag>}
              </Space>
            </Card>
          ))}
        </Space>

        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Card
            size="small"
            data-testid="on-air"
            title={onAir ? 'On the GPU' : 'Nothing rendering'}
            styles={{ header: onAir ? { background: 'rgba(232,161,58,.12)' } : undefined }}
          >
            {onAir ? (
              <Space orientation="vertical" size={2} style={{ width: '100%' }}>
                <Typography.Text strong>
                  {onAir.beatId} · {onAir.says}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {onAir.reel} · {onAir.kind} · {onAir.plugin}
                  {waiting.length ? ` · ${waiting.length} waiting behind it` : ''}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">
                The GPU is idle. Queue shots from a reel&rsquo;s Shots tab.
              </Typography.Text>
            )}
          </Card>

          <Card
            size="small"
            title="Renders"
            data-testid="jobs"
            extra={
              <Segmented
                size="small"
                value={scope}
                onChange={(v) => setScope(v as 'active' | 'all')}
                options={[
                  { label: `Moving or stuck (${(board?.rows ?? []).filter((r) => ACTIVE.has(r.status)).length})`, value: 'active' },
                  { label: `All (${board?.rows.length ?? 0})`, value: 'all' },
                ]}
              />
            }
          >
            <Table<JobRow>
              size="small"
              rowKey={(r) => `${r.slug}:${r.assetId}`}
              dataSource={rows}
              loading={!board}
              pagination={{ pageSize: 12, size: 'small', hideOnSinglePage: true }}
              onRow={(r) => ({ onClick: () => router.push(`/reel/${r.slug}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'Beat', dataIndex: 'beatId', width: 70 },
                {
                  title: 'Says',
                  dataIndex: 'says',
                  ellipsis: true,
                  render: (t: string) => <Typography.Text style={{ fontSize: 13 }}>{t}</Typography.Text>,
                },
                { title: 'Reel', dataIndex: 'reel', width: 200, ellipsis: true },
                { title: 'Plugin', dataIndex: 'plugin', width: 100, render: (p: string) => <Tag>{p}</Tag> },
                {
                  title: 'State',
                  dataIndex: 'status',
                  width: 130,
                  render: (s: JobRow['status'], row) => (
                    <Tooltip title={row.error}>
                      <Tag color={STATUS_COLOUR[s]}>{s}</Tag>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Out',
                  dataIndex: 'durationSec',
                  width: 80,
                  render: (d?: number) => (d ? `${d.toFixed(2)}s` : '—'),
                },
                {
                  title: '',
                  width: 80,
                  render: (_, row) =>
                    row.status === 'failed' || row.status === 'awaiting-manual' ? (
                      <Button
                        size="small"
                        loading={retrying === `${row.slug}:${row.beatId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void retry(row);
                        }}
                      >
                        Retry
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>

          <Card size="small" title={`Waiting on you (${board?.blocked.length ?? 0})`} data-testid="blocked">
            {board && board.blocked.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing is stuck." />
            ) : (
              <Space orientation="vertical" style={{ width: '100%' }} size={8}>
                {(board?.blocked ?? []).slice(0, 12).map((b) => (
                  <div
                    key={`${b.slug}:${b.beatId}`}
                    style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <Tag>{b.beatId}</Tag>
                    <Typography.Text style={{ fontSize: 13, flex: 1, minWidth: 200 }}>{b.why}</Typography.Text>
                    <Button size="small" onClick={() => router.push(`/reel/${b.slug}`)}>
                      Open {b.reel.slice(0, 28)}
                    </Button>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      </div>
    </div>
  );
}
