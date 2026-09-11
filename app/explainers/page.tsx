'use client';
import React from 'react';
import {
  Alert, Button, Card, Empty, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography, message,
} from 'antd';
import { useRouter } from 'next/navigation';

type Summary = {
  slug: string; title: string; theme: string; beats: number; nodes: number;
  seconds: number; updatedAt: string; renderedAt: string | null;
};
type Contract = { themes: string[]; themeModes: Record<string, 'light' | 'dark'> } | null;

export default function ExplainersPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<Summary[]>([]);
  const [contract, setContract] = React.useState<Contract>(null);
  const [loading, setLoading] = React.useState(true);
  const [title, setTitle] = React.useState('');
  const [theme, setTheme] = React.useState<string | undefined>();
  const [creating, setCreating] = React.useState(false);
  // Writing it here is the difference between opening a board about your topic and opening two
  // rows called Before and After.
  const [write, setWrite] = React.useState(false);
  const [audience, setAudience] = React.useState('');
  const [claim, setClaim] = React.useState('');
  const [seconds, setSeconds] = React.useState(18);

  // The `alive` guard is not ceremony: the page can be left while the fetch is in flight, and
  // setting state after that is a leak the console will complain about.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/explainers', { cache: 'no-store' });
        const body = await r.json();
        if (!alive) return;
        setRows(body.explainers ?? []);
        setContract(body.contract ?? null);
        if (body.contract?.themes?.length) setTheme((t) => t ?? body.contract.themes[0]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const r = await fetch('/api/explainers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          theme,
          brief: write && claim.trim()
            ? { topic: title.trim(), audience: audience.trim() || 'engineers', claim: claim.trim(), seconds }
            : undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) { message.error(body.error ?? 'could not create it'); return; }
      // A model that would not answer still leaves an explainer to work in; say so rather than
      // opening a blank board with no explanation.
      if (write && body.drafted === false) message.warning(body.error ?? 'it was created, but not written');
      router.push(`/explainers/${body.slug}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Explainers</Typography.Title>
        <Typography.Text type="secondary">
          One scene that changes. The board holds still while its numbers move — which is what makes
          a before and after read as a comparison rather than two screens.
        </Typography.Text>
      </div>

      {!contract && !loading ? (
        <Alert
          type="warning"
          showIcon
          title="The templates service is not answering on 26200"
          description="You can still write and edit here. Rendering, and the list of themes, need it running — start it from Plugins."
        />
      ) : null}

      <Card size="small">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="What does this one explain?  e.g. What a CDN actually buys you"
            value={title}
            maxLength={48}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={() => void create()}
          />
          <Select
            value={theme}
            onChange={setTheme}
            style={{ width: 190 }}
            placeholder="theme"
            options={(contract?.themes ?? []).map((t) => ({
              value: t,
              label: `${t}  ·  ${contract?.themeModes?.[t] ?? ''}`,
            }))}
            disabled={!contract}
          />
          <Button type="primary" loading={creating} onClick={() => void create()} disabled={!title.trim()}>
            {write ? 'Write it' : 'New explainer'}
          </Button>
        </Space.Compact>

        <Space style={{ marginTop: 10 }} size={8}>
          <Switch size="small" checked={write} onChange={setWrite} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Write the first draft with the model
          </Typography.Text>
        </Space>

        {write ? (
          <Space orientation="vertical" size={8} style={{ width: '100%', marginTop: 10 }}>
            <Input
              placeholder="Audience — who it is for"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
            <Input.TextArea
              placeholder="The one thing that must land"
              autoSize={{ minRows: 2, maxRows: 3 }}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
            />
            <Space>
              <InputNumber min={6} max={60} value={seconds} onChange={(v) => setSeconds(Number(v ?? 16))} suffix="s" />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                The reference channel sits between 14 and 21 seconds.
              </Typography.Text>
            </Space>
          </Space>
        ) : null}
      </Card>

      {rows.length === 0 && !loading ? (
        <Empty description="Nothing here yet. Name one above and it opens with a working two-row board." />
      ) : (
        <Table<Summary>
          size="small"
          loading={loading}
          rowKey="slug"
          dataSource={rows}
          pagination={false}
          onRow={(r) => ({ onClick: () => router.push(`/explainers/${r.slug}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Title', dataIndex: 'title', render: (v: string) => <strong>{v}</strong> },
            { title: 'Theme', dataIndex: 'theme', width: 130, render: (v: string) => <Tag>{v}</Tag> },
            { title: 'Beats', dataIndex: 'beats', width: 80 },
            { title: 'Nodes', dataIndex: 'nodes', width: 80 },
            { title: 'Length', dataIndex: 'seconds', width: 100, render: (v: number) => `${v}s` },
            {
              title: 'Rendered',
              dataIndex: 'renderedAt',
              width: 140,
              render: (v: string | null) => (v ? <Tag color="green">yes</Tag> : <Tag>not yet</Tag>),
            },
          ]}
        />
      )}
    </Space>
  );
}
