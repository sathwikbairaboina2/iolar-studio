'use client';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Radio, Select, Table, Tag, Typography, message } from 'antd';
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
  const [styles, setPatterns] = useState<{ name: string; displayName: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [style, setPattern] = useState('armand');
  const [mode, setMode] = useState<Mode>('topic');
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const load = () =>
    fetch('/api/reel')
      .then((r) => r.json())
      .then((d) => setReels(d.reels ?? []));

  useEffect(() => {
    load();
    fetch('/api/reel/styles')
      .then((r) => r.json())
      .then((d) => setPatterns(d.styles ?? []));
  }, []);

  const source = mode === 'topic' ? topic : mode === 'paste' ? script : mediaUrl;
  const canCreate = !!title.trim() && !!source.trim() && !creating;

  const create = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/reel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, style }),
      });
      const created = await r.json();
      if (!r.ok) throw new Error(created.error ?? 'create failed');

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
        pagination={false}
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
            value={style}
            onChange={setPattern}
            options={styles.map((p) => ({ value: p.name, label: p.displayName }))}
          />
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="topic">From topic</Radio.Button>
            <Radio.Button value="paste">Paste script</Radio.Button>
            <Radio.Button value="reference">From a reel</Radio.Button>
          </Radio.Group>
          {mode === 'topic' && (
            <Input.TextArea
              rows={3}
              placeholder="What is this reel about? Paste a link or a few lines of context."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          )}
          {mode === 'paste' && (
            <Input.TextArea
              rows={6}
              placeholder="Your finished script, spoken word for word."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          )}
          {mode === 'reference' && (
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
