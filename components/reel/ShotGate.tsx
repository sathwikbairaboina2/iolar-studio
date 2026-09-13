'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ResolvedShot } from '@/lib/reel/shots';

/**
 * The last look before the spend.
 *
 * A talking head is about thirteen minutes of GPU on this machine, so a wrong brief or a
 * page that resolves to nothing is worth catching here rather than in the morning. Rows come
 * from the same function the run uses, so what is listed is what would be sent.
 */

type Props = { slug: string; onQueued?: () => void };

export default function ShotGate({ slug, onQueued }: Props) {
  const [shots, setShots] = useState<ResolvedShot[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/shots/preview`).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!d || !Array.isArray(d.shots)) return;
    setShots(d.shots as ResolvedShot[]);
    // Blocked rows start unticked: sending one only buys an asset in `awaiting-manual`.
    setPicked(new Set((d.shots as ResolvedShot[]).filter((s) => !s.blocked).map((s) => s.beatId)));
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const toggle = (beatId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(beatId)) next.delete(beatId);
      else next.add(beatId);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/reel/${slug}/shots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beatIds: [...picked] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'the renderers would not take that');
      message.success(`queued ${picked.size} shot${picked.size === 1 ? '' : 's'}`);
      onQueued?.();
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (shots && shots.length === 0) {
    return (
      <Empty
        data-testid="gate-empty"
        description="Nothing is waiting on a renderer — every beat already has its footage, or is a title card."
      />
    );
  }

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Typography.Text type="secondary">
        Exactly what would be sent. Untick anything you do not want made, then queue the rest.
      </Typography.Text>

      <Table<ResolvedShot>
        size="small"
        rowKey="beatId"
        pagination={false}
        expandable={{
          rowExpandable: (row) => !!row.payload,
          expandedRowRender: (row) => (
            <pre
              data-testid={`gate-payload-${row.beatId}`}
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          ),
        }}
        dataSource={shots ?? []}
        loading={!shots}
        onRow={(row) => ({ 'data-testid': `gate-row-${row.beatId}` } as never)}
        columns={[
          {
            title: '',
            width: 40,
            render: (_, row) => (
              <span data-testid={`gate-pick-${row.beatId}`}>
                <Checkbox
                  checked={picked.has(row.beatId)}
                  disabled={!!row.blocked}
                  onChange={() => toggle(row.beatId)}
                />
              </span>
            ),
          },
          { title: 'Beat', dataIndex: 'beatId', width: 70 },
          {
            title: 'Renderer',
            width: 130,
            render: (_, row) => (row.provider ? <Tag>{row.provider}</Tag> : <Tag color="red">none</Tag>),
          },
          { title: 'Seconds', dataIndex: 'seconds', width: 90, render: (v: number) => v.toFixed(1) },
          {
            title: 'Sends',
            render: (_, row) =>
              row.blocked ? (
                <Typography.Text type="danger">{row.blocked}</Typography.Text>
              ) : (
                <Space orientation="vertical" size={0}>
                  <Typography.Text>{row.brief}</Typography.Text>
                  {row.url && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.url}
                      {row.highlight ? ` — “${row.highlight}”` : ''}
                    </Typography.Text>
                  )}
                  {row.imagePath && (
                    <Tooltip title={row.imagePath}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        presenter: {row.imagePath.split(/[\\/]/).at(-1)}
                      </Typography.Text>
                    </Tooltip>
                  )}
                </Space>
              ),
          },
        ]}
      />

      {shots?.some((s) => s.blocked) && (
        <Alert
          type="warning"
          showIcon
          title="Some beats cannot be rendered yet"
          description="Each one says what it is missing. Fix that, refresh, and they become tickable."
        />
      )}

      <Space>
        <Button
          data-testid="gate-run"
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={busy}
          disabled={picked.size === 0}
          onClick={run}
        >
          Render {picked.size} shot{picked.size === 1 ? '' : 's'}
        </Button>
        <Button data-testid="gate-refresh" icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </Space>
    </Space>
  );
}
