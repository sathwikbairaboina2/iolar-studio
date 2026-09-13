'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Radio, Select, Table, Tag, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';

type Meta = {
  slug: string;
  title: string;
  style: string;
  beats: number;
  durationSec: number;
  status: string;
  updatedAt: string;
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'orange',
  voiced: 'blue',
  assembled: 'purple',
  exported: 'green',
};

type Mode = 'topic' | 'paste' | 'reference';

export default function ReelList() {
  const [reels, setReels] = useState<Meta[]>([]);
  // The list only grows; the table asks for the page it draws and nothing more.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [styles, setStyles] = useState<{ name: string; displayName: string }[]>([]);
  const [patterns, setPatterns] = useState<{ name: string; displayName: string; themes: string[] }[]>([]);
  const [patternName, setPatternName] = useState<string>('');
  const [theme, setTheme] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('armand');
  const [mode, setMode] = useState<Mode>('topic');
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const load = useCallback(
    () =>
      fetch(`/api/reel?limit=${pageSize}&offset=${(page - 1) * pageSize}`)
        .then((r) => r.json())
        .then((d) => {
          setReels(d.reels ?? []);
          setTotal(d.total ?? 0);
        }),
    [page]
  );

  // The page the pager moved to is the page that is fetched.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch('/api/reel/styles')
      .then((r) => r.json())
      .then((d) => setStyles(d.styles ?? []));
    // Patterns appear only while the templates service answers; the list is empty otherwise.
    fetch('/api/reel/patterns')
      .then((r) => r.json())
      .then((d) => setPatterns(d.patterns ?? []))
      .catch(() => setPatterns([]));
  }, []);

  const source = mode === 'topic' ? topic : mode === 'paste' ? script : mediaUrl;
  // A pattern reel gets its script from Research, so the source is not needed to create it.
  const canCreate = !!title.trim() && (!!patternName || !!source.trim()) && !creating;

  const create = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/reel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, style, pattern: patternName ? { name: patternName, theme } : null }),
      });
      const created = await r.json();
      if (!r.ok) throw new Error(created.error ?? 'create failed');

      if (patternName) {
        // The pattern's script comes from the Research tab; nothing to plan here.
        setOpen(false);
        router.push(`/reel/${created.slug}`);
        return;
      }
      message.info('Claude is writing the script…');
      const plan = await fetch(`/api/reel/${created.slug}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, topic, script, mediaUrl }),
      });
      if (!plan.ok) {
        const err = await plan.json().catch(() => ({}));
        message.warning(`Script step failed: ${err.error ?? plan.status}. Opening the studio anyway.`);
      }
      setOpen(false);
      router.push(`/reel/${created.slug}`);
    } catch (err) {
      message.error(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Reels
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          New reel
        </Button>
      </div>

      <Table<Meta>
        rowKey="slug"
        dataSource={reels}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: setPage,
          showSizeChanger: false,
          hideOnSinglePage: true,
          size: 'small',
        }}
        onRow={(row) => ({ onClick: () => router.push(`/reel/${row.slug}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Title', dataIndex: 'title' },
          { title: 'Style', dataIndex: 'style' },
          { title: 'Beats', dataIndex: 'beats', width: 90 },
          {
            title: 'Length',
            dataIndex: 'durationSec',
            width: 110,
            render: (s: number) => (s ? `${s.toFixed(1)}s` : '—'),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (s: string) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{s}</Tag>,
          },
          {
            title: 'Updated',
            dataIndex: 'updatedAt',
            width: 190,
            render: (v: string) => new Date(v).toLocaleString('en-GB'),
          },
        ]}
      />

      <Modal
        title="New reel"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={create}
        okText="Create"
        confirmLoading={creating}
        okButtonProps={{ disabled: !canCreate }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Input placeholder="Title, e.g. xAI drops Grok Bot" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select
            value={patternName}
            onChange={(v) => {
              setPatternName(v);
              setTheme(patterns.find((x) => x.name === v)?.themes[0] ?? '');
            }}
            options={[{ value: '', label: 'Freeform (beats)' }, ...patterns.map((x) => ({ value: x.name, label: `Pattern: ${x.displayName}` }))]}
            data-testid="pattern-pick"
          />
          {patternName && (
            <Select
              value={theme}
              onChange={setTheme}
              options={(patterns.find((x) => x.name === patternName)?.themes ?? []).map((t) => ({ value: t, label: t }))}
              data-testid="theme-pick"
            />
          )}
          {patterns.length === 0 && (
            <Typography.Text type="secondary">Patterns appear when reels-templates is running (Plugins).</Typography.Text>
          )}
          <Select
            value={style}
            onChange={setStyle}
            options={styles.map((p) => ({ value: p.name, label: p.displayName }))}
          />
          {!patternName && <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="topic">From topic</Radio.Button>
            <Radio.Button value="paste">Paste script</Radio.Button>
            <Radio.Button value="reference">From a reel</Radio.Button>
          </Radio.Group>}
          {!patternName && mode === 'topic' && (
            <Input.TextArea
              rows={3}
              placeholder="What is this reel about? Paste a link or a few lines of context."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          )}
          {!patternName && mode === 'paste' && (
            <Input.TextArea
              rows={6}
              placeholder="Your finished script, spoken word for word."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          )}
          {!patternName && mode === 'reference' && (
            <Input
              placeholder="http://localhost:3000/api/media/…"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
            />
          )}
        </div>
      </Modal>
    </>
  );
}
