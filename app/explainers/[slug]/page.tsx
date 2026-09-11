'use client';
import React from 'react';
import { Alert, Button, Card, Col, Row, Segmented, Space, Tag, Typography, message } from 'antd';
import { useParams } from 'next/navigation';
import ScenePreview from '@/components/explainer/ScenePreview';
import type { Scene } from '@/lib/explainer/schema';

type Step = {
  id: string; role: string; startFrame: number; durationFrames: number; mutations: number; scene: Scene;
};
type Loaded = {
  slug: string;
  doc: Record<string, unknown> & { theme: string };
  seconds: number | null;
  steps: Step[];
  foldError: { beatId: string; message: string } | null;
};

const ROLE_COLOUR: Record<string, string> = { hook: 'magenta', step: 'blue', payoff: 'green', cta: 'gold' };

export default function ExplainerEditor() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = React.useState<Loaded | null>(null);
  const [beat, setBeat] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [rendering, setRendering] = React.useState(false);
  const [mp4, setMp4] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'dark' | 'light'>('dark');

  const apply = React.useCallback((body: Loaded) => {
    setData(body);
    setDraft(JSON.stringify(body.doc, null, 2));
    setDirty(false);
    setBeat((b) => Math.min(b, Math.max(0, body.steps.length - 1)));
  }, []);

  /** Re-read after a save or a render. Called from handlers, never from an effect. */
  const reload = React.useCallback(async () => {
    const r = await fetch(`/api/explainers/${slug}`, { cache: 'no-store' });
    if (!r.ok) { message.error('could not load it'); return; }
    apply(await r.json());
  }, [slug, apply]);

  // The `alive` guard is not ceremony: the page can be left while the fetch is in flight, and
  // setting state after that is a leak the console will complain about.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/explainers/${slug}`, { cache: 'no-store' });
      if (!alive) return;
      if (!r.ok) { message.error('could not load it'); return; }
      const body: Loaded = await r.json();
      if (alive) apply(body);
    })();
    return () => { alive = false; };
  }, [slug, apply]);

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
                onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
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
