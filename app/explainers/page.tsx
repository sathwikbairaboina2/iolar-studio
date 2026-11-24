'use client';
import React from 'react';
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Space, Tag, Typography } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { message } from '@/lib/ui/message';
import { ago } from '@/lib/explainer/browse';
import type { ExplainerSummary } from '@/lib/explainer/store';
import type { Explainer2Summary } from '@/lib/explainer2/store';

/**
 * Explainers: each video is designed in code, in the aiiolar look, from a brief. The ten earlier board
 * explainers stay below as read-only history: their poster and last render, nothing to edit.
 */

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 };
const TILE: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(128,128,128,.22)',
  borderRadius: 12, background: 'rgba(128,128,128,.04)', cursor: 'pointer',
};
const FRAME: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: '9 / 16', overflow: 'hidden', background: 'rgba(128,128,128,.10)', display: 'grid', placeItems: 'center' };

const STAGE_LABEL: Record<string, string> = { script: 'writing', factcheck: 'fact check', voice: 'voice', design: 'design', gates: 'checks', critic: 'critic', render: 'render', done: 'done' };

export default function ExplainersPage() {
  const router = useRouter();
  const [rows, setRows] = React.useState<Explainer2Summary[]>([]);
  const [legacy, setLegacy] = React.useState<ExplainerSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [playing, setPlaying] = React.useState<ExplainerSummary | null>(null);
  const [form] = Form.useForm();

  const load = React.useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch('/api/explainers2', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/explainers', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    return { rows: (a.explainers ?? []) as Explainer2Summary[], legacy: (b.explainers ?? []) as ExplainerSummary[] };
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const got = await load();
        if (!alive) return;
        setRows(got.rows);
        setLegacy(got.legacy.filter((r) => r.renderedAt));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [load]);

  const create = async (values: { topic: string; audience: string; claim: string; seconds: number }) => {
    setCreating(true);
    try {
      const r = await fetch('/api/explainers2', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...values, start: true }),
      });
      const body = await r.json();
      if (!r.ok) { message.error(body.error ?? 'could not create it'); return; }
      router.push(`/explainers/designed/${body.slug}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Explainers</Typography.Title>
        <Typography.Text type="secondary">
          Give it a topic and the one thing that must land. It writes and fact-checks the script, speaks it, designs the video in code
          and renders it, stage by stage, so a stage that fails can be run again on its own.
        </Typography.Text>
      </div>

      <Card size="small" title="New explainer">
        <Form form={form} layout="vertical" initialValues={{ seconds: 30 }} onFinish={(v) => void create(v)}>
          <Form.Item name="topic" label="Topic" rules={[{ required: true, message: 'what is it about?' }]}>
            <Input placeholder="e.g. Why caching feels instant" maxLength={120} />
          </Form.Item>
          <Form.Item name="audience" label="Audience" rules={[{ required: true, message: 'who is it for?' }]}>
            <Input placeholder="e.g. backend engineers preparing for system design interviews" maxLength={120} />
          </Form.Item>
          <Form.Item name="claim" label="The one claim that must land" rules={[{ required: true, message: 'what should they remember?' }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={300} />
          </Form.Item>
          <Form.Item name="seconds" label="Length" rules={[{ required: true }]}>
            <InputNumber min={20} max={45} suffix="s" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={creating}>Create and design</Button>
        </Form>
      </Card>

      {rows.length === 0 && !loading ? (
        <Empty description="Nothing designed yet. Fill in a brief above." />
      ) : (
        <div className="st-cards-2" style={GRID}>
          {rows.map((r) => (
            <div key={r.slug} style={TILE} role="button" tabIndex={0} onClick={() => router.push(`/explainers/designed/${r.slug}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/explainers/designed/${r.slug}`); }}>
              <div style={FRAME}>
                {r.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/explainers2/${r.slug}/poster?v=${encodeURIComponent(r.renderId ?? '')}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>not rendered yet</Typography.Text>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <Typography.Text strong ellipsis style={{ display: 'block' }}>{r.title ?? r.topic}</Typography.Text>
                <Space size={6} wrap>
                  <Tag color={r.failed ? 'red' : r.stage === 'done' ? 'green' : 'blue'} style={{ marginInlineEnd: 0 }}>
                    {r.failed ?? STAGE_LABEL[r.stage] ?? r.stage}
                  </Tag>
                  {r.criticMin !== null ? <Tag color={r.criticMin >= 8 ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>critic {r.criticMin}</Tag> : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ago(r.updatedAt)}</Typography.Text>
                </Space>
              </div>
            </div>
          ))}
        </div>
      )}

      {legacy.length ? (
        <>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Legacy</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>The earlier board explainers: their poster and last render only.</Typography.Text>
          </div>
          <div className="st-cards-2" style={GRID}>
            {legacy.map((r) => (
              <div key={r.slug} style={TILE} role="button" tabIndex={0} onClick={() => setPlaying(r)} onKeyDown={(e) => { if (e.key === 'Enter') setPlaying(r); }}>
                <div style={FRAME}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/explainers/${r.slug}/poster?v=${encodeURIComponent(r.renderedAt ?? '')}`} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%' }} />
                  <PlayCircleOutlined style={{ position: 'relative', fontSize: 34, color: '#fff', filter: 'drop-shadow(0 2px 6px #000)' }} />
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <Typography.Text strong ellipsis style={{ display: 'block' }}>{r.title}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>rendered {ago(r.renderedAt)}</Typography.Text>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <Modal open={!!playing} title={playing?.title} footer={null} onCancel={() => setPlaying(null)} destroyOnHidden width={420}>
        {playing ? (
          <video controls autoPlay style={{ width: '100%', maxHeight: '70vh', background: '#000' }} src={`/api/explainers/${playing.slug}/mp4`} />
        ) : null}
      </Modal>
    </Space>
  );
}
