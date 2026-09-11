'use client';
import React from 'react';
import { Alert, Button, Card, Col, Row, Segmented, Space, Tag, Typography, message } from 'antd';
import { useParams } from 'next/navigation';
import ScenePreview from '@/components/explainer/ScenePreview';
import { useExplainerEditor } from './useExplainerEditor';

const ROLE_COLOUR: Record<string, string> = { hook: 'magenta', step: 'blue', payoff: 'green', cta: 'gold' };

export default function ExplainerEditor() {
  const { slug } = useParams<{ slug: string }>();
  const { data, log, busy, move, reload } = useExplainerEditor(slug);
  const [beatSel, setBeat] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [rendering, setRendering] = React.useState(false);
  const [mp4, setMp4] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'dark' | 'light'>('dark');

  // The textarea is derived, not synchronised. `edit` holds what was typed along with the document
  // it was typed against; the hook hands back a fresh object on every reload, so a save, render,
  // undo or redo drops the stale draft by identity without an effect to do it.
  const [edit, setEdit] = React.useState<{ against: unknown; text: string } | null>(null);
  const dirty = !!edit && edit.against === data?.doc;
  const draft = dirty ? edit!.text : JSON.stringify(data?.doc ?? {}, null, 2);
  const beat = Math.min(beatSel, Math.max(0, (data?.steps.length ?? 1) - 1));

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      message.error(`that is not valid JSON: ${(e as Error).message}`);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/explainers/${slug}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed),
      });
      const body = await r.json();
      if (!r.ok) {
        message.error(body.beatId ? `${body.beatId}: ${body.error}` : (body.error ?? 'it would not save'));
        return;
      }
      message.success('saved');
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const renderIt = async () => {
    setRendering(true);
    setMp4(null);
    try {
      const r = await fetch(`/api/explainers/${slug}/render`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) { message.error(body.error ?? 'the render failed'); return; }
      message.success(`rendered ${body.seconds ?? '?'}s`);
      setMp4(`${body.mp4}?t=${Date.now()}`);
      await reload();
    } finally {
      setRendering(false);
    }
  };

  const step = data?.steps[beat];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Row align="middle" gutter={12}>
        <Col flex="auto">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {String((data?.doc?.scene as { title?: string } | undefined)?.title ?? slug)}
          </Typography.Title>
          <Typography.Text type="secondary">
            {data?.seconds ? `${data.seconds}s · ` : ''}{data?.steps.length ?? 0} beats · theme {data?.doc.theme}
          </Typography.Text>
        </Col>
        <Col>
          <Space>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'dark' | 'light')}
              options={[{ label: 'dark', value: 'dark' }, { label: 'light', value: 'light' }]}
            />
            <Button onClick={() => void move('undo')} disabled={busy || log.cursor === 0}>Undo</Button>
            <Button onClick={() => void move('redo')} disabled={busy || log.cursor >= log.entries.length}>
              Redo
            </Button>
            <Button onClick={() => void save()} loading={saving} type={dirty ? 'primary' : 'default'}>
              Save
            </Button>
            <Button onClick={() => void renderIt()} loading={rendering} disabled={!!data?.foldError}>
              Render
            </Button>
          </Space>
        </Col>
      </Row>

      {data?.foldError ? (
        <Alert
          type="error"
          showIcon
          message={`Beat ${data.foldError.beatId} cannot be applied`}
          description={`${data.foldError.message} — the beats before it are fine; this one refers to something that is not on the board yet.`}
        />
      ) : null}

      <Row gutter={16}>
        <Col span={7}>
          <Card size="small" title="Beats" styles={{ body: { padding: 0 } }}>
            {(data?.steps ?? []).map((s, i) => (
              <div
                key={s.id}
                onClick={() => setBeat(i)}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderLeft: `4px solid ${i === beat ? '#1677ff' : 'transparent'}`,
                  background: i === beat ? 'rgba(22,119,255,.08)' : undefined,
                  borderBottom: '1px solid rgba(128,128,128,.14)',
                }}
              >
                <Space size={8}>
                  <Tag color={ROLE_COLOUR[s.role]} style={{ marginInlineEnd: 0 }}>{s.role}</Tag>
                  <strong>{s.id}</strong>
                </Space>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 3 }}>
                  {(s.durationFrames / 30).toFixed(1)}s · {s.mutations} change{s.mutations === 1 ? '' : 's'}
                  {' · '}{s.scene.rows.length} nodes
                </div>
              </div>
            ))}
          </Card>

          <Card
            size="small"
            title="History"
            style={{ marginTop: 12 }}
            styles={{ body: { padding: 0, maxHeight: 220, overflowY: 'auto' } }}
          >
            {log.entries.length === 0 ? (
              <div style={{ padding: '10px 14px', opacity: 0.6, fontSize: 12 }}>Nothing yet.</div>
            ) : (
              log.entries.map((e, i) => (
                <div
                  key={e.seq}
                  style={{
                    padding: '8px 14px', fontSize: 12,
                    opacity: i < log.cursor ? 1 : 0.4,
                    borderBottom: '1px solid rgba(128,128,128,.12)',
                  }}
                >
                  <Tag color={e.actor === 'agent' ? 'purple' : 'default'} style={{ marginInlineEnd: 6 }}>
                    {e.actor}
                  </Tag>
                  {e.summary}
                </div>
              ))
            )}
          </Card>
        </Col>

        <Col span={9}>
          <Card size="small" title={step ? `The board at ${step.id}` : 'The board'}>
            <div style={{ containerType: 'inline-size' }}>
              {step ? <ScenePreview scene={step.scene} mode={mode} /> : null}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              An approximation, drawn here so a change shows at once. Render for the real thing.
            </Typography.Text>
          </Card>
        </Col>

        <Col span={8}>
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small" title="Document">
              <textarea
                value={draft}
                onChange={(e) => setEdit({ against: data?.doc, text: e.target.value })}
                spellCheck={false}
                style={{
                  width: '100%', height: 420, fontFamily: 'ui-monospace, monospace', fontSize: 12,
                  background: 'transparent', color: 'inherit',
                  border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: 10, resize: 'vertical',
                }}
              />
            </Card>
            {mp4 ? (
              <Card size="small" title="Rendered">

                <video src={mp4} controls loop style={{ width: '100%', borderRadius: 8 }} />
              </Card>
            ) : null}
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
