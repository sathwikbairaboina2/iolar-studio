'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Space, Table, Tag, Typography, message } from 'antd';
import { ExportOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { WeekRow, WeekStage } from '@/lib/jobs/board';

/**
 * The weekly jobs reel, one row per week.
 *
 * The jobs-reel plugin owns the weeks and renders the reel; this page is the studio's
 * window onto its board. It lists what the board lists, re-runs the two stages the board
 * lets anyone re-run, and links into the board for everything else. Voice, render and
 * export are minutes long and belong to `npm run weekly` in a terminal.
 */

type Row = WeekRow & { links: { board: string; reel: string; preview: string } };

const STAGE_COLOUR: Record<WeekStage, string> = {
  empty: 'default',
  imported: 'blue',
  planned: 'geekblue',
  scripted: 'purple',
  voiced: 'cyan',
  exported: 'green',
};

export default function JobsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [board, setBoard] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs/weeks', { cache: 'no-store' });
      const d = await r.json();
      setBoard(d.board ?? '');
      if (!r.ok) {
        setError(d.error ?? `the board answered ${r.status}`);
        setRows([]);
        return;
      }
      setError(null);
      setRows(d.weeks as Row[]);
    } catch (err) {
      setError(String(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const run = async (week: string, stage: 'summarise' | 'plan') => {
    const key = `${week}:${stage}`;
    setRunning(key);
    try {
      const r = await fetch(`/api/jobs/weeks/${week}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? d.message ?? `the board answered ${r.status}`);
      message.success(`${stage} ran for ${week}${d.message ? ` — ${d.message}` : ''}`);
      await refresh();
    } catch (err) {
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      setRunning(null);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0, flex: 1 }}>
          Jobs
        </Typography.Title>
        {board && (
          <Button icon={<ExportOutlined />} href={board} target="_blank">
            Open board
          </Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {error && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="The jobs-reel board is not answering"
          description={
            <span>
              {error}. Start it from{' '}
              <a onClick={() => router.push('/plugins')}>Plugins</a>, or run <code>npm run dev</code> in{' '}
              <code>projects/plugins/jobs-reel-plugin</code>.
            </span>
          }
        />
      )}

      <Table<Row>
        rowKey="week"
        dataSource={rows ?? []}
        loading={rows === null}
        pagination={false}
        locale={{ emptyText: error ? 'Nothing to show while the board is down.' : 'No weeks yet. Run npm run weekly in the plugin.' }}
        columns={[
          { title: 'Week', dataIndex: 'week', width: 120, render: (w: string) => <strong>{w}</strong> },
          {
            title: 'Stage',
            dataIndex: 'stage',
            width: 120,
            render: (s: WeekStage) => <Tag color={STAGE_COLOUR[s] ?? 'default'}>{s}</Tag>,
          },
          { title: 'Roles', dataIndex: 'counted', width: 90 },
          {
            title: 'Rejected',
            dataIndex: 'rejected',
            width: 100,
            render: (n: number) => (n ? <Tag color="red">{n}</Tag> : '0'),
          },
          { title: 'Style', dataIndex: 'style', width: 140, render: (s: string | null) => s ?? '—' },
          {
            title: 'Reel',
            dataIndex: 'hasExport',
            width: 110,
            render: (has: boolean, row) =>
              has ? (
                <Button size="small" icon={<PlayCircleOutlined />} href={row.links.reel} target="_blank">
                  reel.mp4
                </Button>
              ) : (
                <Typography.Text type="secondary">not yet</Typography.Text>
              ),
          },
          {
            title: '',
            key: 'actions',
            render: (_: unknown, row) => (
              <Space size={4}>
                <Button
                  size="small"
                  loading={running === `${row.week}:summarise`}
                  disabled={row.stage === 'empty'}
                  onClick={() => void run(row.week, 'summarise')}
                >
                  summarise
                </Button>
                <Button
                  size="small"
                  loading={running === `${row.week}:plan`}
                  disabled={row.stage === 'empty' || row.stage === 'imported'}
                  onClick={() => void run(row.week, 'plan')}
                >
                  plan
                </Button>
                <Button size="small" type="link" href={row.links.board} target="_blank">
                  open on board
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
