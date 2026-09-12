'use client';
import React from 'react';
import { Alert, Button, Card, Col, Row, Segmented, Space, Tag, Typography, message } from 'antd';
import { useParams } from 'next/navigation';
import ScenePreview from '@/components/explainer/ScenePreview';
import { ago } from '@/lib/explainer/browse';
import { useExplainerEditor } from './useExplainerEditor';
import { useExplainerRenders, type RenderRecord } from './useExplainerRenders';
import ScriptCard from './ScriptCard';
import BeatRail from './BeatRail';
import RowInspector from './RowInspector';
import MutationList from './MutationList';

const RENDER_COLOUR: Record<string, string> = {
  queued: 'default', preparing: 'blue', rendering: 'processing', done: 'green', failed: 'red',
};

export default function ExplainerEditor() {
  const { slug } = useParams<{ slug: string }>();
  const { data, log, busy, run, move, reload } = useExplainerEditor(slug);
  const [beatSel, setBeat] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [mode, setMode] = React.useState<'dark' | 'light'>('dark');
  const { log: renders, submitting, submit: startRender, stop: stopRender } = useExplainerRenders(slug);
  const [watching, setWatching] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);

  // The textarea is derived, not synchronised. `edit` holds what was typed along with the document
  // it was typed against; the hook hands back a fresh object on every reload, so a save, render,
  // undo or redo drops the stale draft by identity without an effect to do it.
  const [edit, setEdit] = React.useState<{ against: unknown; text: string } | null>(null);
  const dirty = !!edit && edit.against === data?.doc;
  const draft = dirty ? edit!.text : JSON.stringify(data?.doc ?? {}, null, 2);
  const beat = Math.min(beatSel, Math.max(0, (data?.steps.length ?? 1) - 1));
  const step = data?.steps[beat];

  const live = renders.renders.find((r) => r.state !== 'done' && r.state !== 'failed') ?? null;
  const done = renders.renders.filter((r) => r.state === 'done');
  // What plays is whatever was clicked, and the newest finished render until something is.
  const playing = done.find((r) => r.id === watching) ?? done[0] ?? null;
  const stale = (r: RenderRecord) => Boolean(renders.currentHash) && r.docHash !== renders.currentHash;

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
            <Button
              onClick={() => void startRender()}
              loading={submitting}
              disabled={!!data?.foldError || !!live}
            >
              {live ? `Rendering ${Math.round((live.progress ?? 0) * 100)}%` : 'Render'}
            </Button>
            {live ? <Button danger onClick={() => void stopRender(live.id)}>Stop</Button> : null}
          </Space>
        </Col>
      </Row>

      {data?.foldError ? (
        <Alert
          type="error"
          showIcon
          title={`Beat ${data.foldError.beatId} cannot be applied`}
          description={`${data.foldError.message} — the beats before it are fine; this one refers to something that is not on the board yet.`}
        />
      ) : null}

      <Row gutter={16}>
        <Col span={7}>
          <Card size="small" title="Beats">
            <BeatRail
              steps={data?.steps ?? []}
              selected={beat}
              busy={busy}
              onSelect={(i) => setBeat(i)}
              onRun={run}
            />
          </Card>

          <div style={{ marginTop: 12 }}>
            <RowInspector
              doc={data?.doc ?? null}
              beatId={step?.id ?? null}
              rowId={picked}
              busy={busy}
              onRun={run}
              onClose={() => setPicked(null)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <MutationList doc={data?.doc ?? null} beatId={step?.id ?? null} busy={busy} onRun={run} />
          </div>

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

          <div style={{ marginTop: 12 }}>
            <ScriptCard slug={slug} doc={data?.doc ?? null} fit={data?.fit ?? null} onApplied={reload} />
          </div>
        </Col>

        <Col span={9}>
          <Card size="small" title={step ? `The board at ${step.id}` : 'The board'}>
            <div style={{ containerType: 'inline-size' }}>
              {step ? (
                <ScenePreview
                  scene={step.scene}
                  mode={mode}
                  selected={picked}
                  onSelect={(rowId) => setPicked(rowId === picked ? null : rowId)}
                />
              ) : null}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              An approximation, drawn here so a change shows at once. Click a node to edit it;
              render for the real thing.
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
            {playing ? (
              <Card
                size="small"
                title={`Rendered ${ago(playing.finishedAt ?? playing.submittedAt)}`}
                extra={stale(playing) ? <Tag color="orange">older document</Tag> : null}
              >
                <video
                  key={playing.id}
                  src={`/api/explainers/${slug}/renders/${playing.id}/mp4`}
                  controls
                  loop
                  style={{ width: '100%', borderRadius: 8 }}
                />
              </Card>
            ) : null}

            <Card size="small" title="Renders" styles={{ body: { padding: 0, maxHeight: 260, overflowY: 'auto' } }}>
              {renders.renders.length === 0 ? (
                <div style={{ padding: '10px 14px', opacity: 0.6, fontSize: 12 }}>Nothing rendered yet.</div>
              ) : (
                renders.renders.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => r.state === 'done' && setWatching(r.id)}
                    style={{
                      padding: '8px 14px', fontSize: 12,
                      cursor: r.state === 'done' ? 'pointer' : 'default',
                      background: playing?.id === r.id ? 'rgba(22,119,255,.08)' : undefined,
                      borderBottom: '1px solid rgba(128,128,128,.12)',
                    }}
                  >
                    <Space size={6} wrap>
                      <Tag color={RENDER_COLOUR[r.state]} style={{ marginInlineEnd: 0 }}>
                        {r.state === 'rendering' ? `${Math.round((r.progress ?? 0) * 100)}%` : r.state}
                      </Tag>
                      <span>{ago(r.submittedAt)}</span>
                      {r.seconds ? <span style={{ opacity: 0.6 }}>{r.seconds}s</span> : null}
                      <span style={{ opacity: 0.6 }}>{r.theme}</span>
                      {stale(r) ? <Tag color="orange">older document</Tag> : null}
                    </Space>
                    {r.error ? <div style={{ color: '#cf1322', marginTop: 4 }}>{r.error}</div> : null}
                  </div>
                ))
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
