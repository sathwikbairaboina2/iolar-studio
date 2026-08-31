'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Progress, Radio, Space, Steps, Table, Tag, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

/**
 * Approved script to queued renders.
 *
 * The stage a reel is at is derived on the server from what is actually on
 * disk — beats carrying a source line, a voiceover file, word timings, cut
 * audio — so this panel asks where the build got to and draws that. A refresh
 * mid-build loses nothing, which matters when a stage is minutes long.
 *
 * The voice is the only fork: record it yourself and upload, or have the studio
 * speak it with the local engine. Whisper aligns either one the same way, which
 * is why everything after that stage is identical.
 */

const STAGES = ['unbuilt', 'bridged', 'voiced', 'aligned', 'sliced', 'rendering', 'done'] as const;
const LABELS = ['Beats', 'Voice', 'Align', 'Cut', 'Render', 'Done'];

type State = {
  stage: (typeof STAGES)[number];
  beats: number;
  renderable: number;
  queued: number;
  ready: number;
  failed: number;
  awaitingManual: number;
};

type Beat = { id: string; role: string; text: string; shot: { kind: string; sourceLineId: string | null; assetId?: string } };

const NEXT: Record<string, string> = {
  unbuilt: 'Plan the beats',
  bridged: 'Add the voice',
  voiced: 'Align the voice',
  aligned: 'Cut the audio',
  sliced: 'Queue the renders',
};

export default function BuildBoard({ slug, beats }: { slug: string; beats: Beat[] }) {
  const [state, setState] = useState<State | null>(null);
  const [voice, setVoice] = useState<'supplied' | 'tts'>('tts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/build`);
    if (r.ok) setState(await r.json());
  }, [slug]);

  useEffect(() => {
    load();
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [load]);

  // While the plugins are working, the truth is on their side of the wire.
  useEffect(() => {
    if (state?.stage !== 'rendering') return;
    polling.current = setInterval(load, 5000);
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [state?.stage, load]);

  const build = async (auto: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/reel/${slug}/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice, auto }),
      });
      const body = await r.json();
      if (!r.ok) setError(body.error ?? 'the build did not advance');
      else setState(body);
    } catch {
      setError('the build did not come back — reloading where it got to');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/reel/${slug}/vo`, { method: 'PUT', body: await file.arrayBuffer() });
      if (!r.ok) setError((await r.json()).error ?? 'upload failed');
      else setVoice('supplied');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const step = state ? Math.min(STAGES.indexOf(state.stage), LABELS.length - 1) : 0;
  const renderable = beats.filter((b) => b.shot.kind === 'screen' || b.shot.kind === 'talking-head');

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Steps size="small" current={step} items={LABELS.map((title) => ({ title }))} />

      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}

      {state?.stage === 'unbuilt' && (
        <Card size="small" title="Plan the beats">
          <Typography.Paragraph type="secondary">
            The approved script is split into shots without changing a word — a plan that paraphrases it is
            refused. Each beat remembers the line it came from, which is how a page shot finds its source.
          </Typography.Paragraph>
        </Card>
      )}

      {state?.stage === 'bridged' && (
        <Card size="small" title="The voice">
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            <Radio.Group value={voice} onChange={(e) => setVoice(e.target.value)}>
              <Radio.Button value="tts">Speak it here</Radio.Button>
              <Radio.Button value="supplied">I recorded it</Radio.Button>
            </Radio.Group>
            <Typography.Text type="secondary">
              {voice === 'tts'
                ? 'Synthesised locally, then aligned. Nothing leaves this machine.'
                : 'Upload the narration for the whole script; it is cut into one file per beat.'}
            </Typography.Text>
            {voice === 'supplied' && (
              <Upload.Dragger
                accept="audio/*"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  upload(file as unknown as File);
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">Drop the voiceover here</p>
              </Upload.Dragger>
            )}
          </Space>
        </Card>
      )}

      {state && (
        <Card
          size="small"
          title={`${renderable.length} of ${beats.length} beats need a renderer`}
          extra={
            NEXT[state.stage] ? (
              <Space>
                <Button loading={busy} onClick={() => build(false)}>{NEXT[state.stage]}</Button>
                <Button type="primary" loading={busy} onClick={() => build(true)}>Build it all</Button>
              </Space>
            ) : (
              <Tag color={state.stage === 'done' ? 'green' : 'blue'}>{state.stage}</Tag>
            )
          }
        >
          {state.stage === 'rendering' && (
            <Progress
              percent={Math.round((state.ready / Math.max(1, state.renderable)) * 100)}
              status={state.failed ? 'exception' : 'active'}
            />
          )}
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={beats}
            columns={[
              { title: '', dataIndex: 'id', width: 48 },
              {
                title: 'Shot',
                dataIndex: ['shot', 'kind'],
                width: 130,
                render: (kind: string) => (
                  <Tag color={kind === 'screen' ? 'blue' : kind === 'talking-head' ? 'purple' : undefined}>
                    {kind === 'screen' ? 'page' : kind === 'talking-head' ? 'presenter' : kind}
                  </Tag>
                ),
              },
              { title: 'Says', dataIndex: 'text', ellipsis: true },
              {
                title: 'Source',
                width: 90,
                render: (_: unknown, b: Beat) =>
                  b.shot.kind === 'screen' ? (
                    b.shot.sourceLineId ? <Tag>{b.shot.sourceLineId}</Tag> : <Tag color="orange">none</Tag>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}

      {state?.stage === 'done' && state.failed === 0 && state.awaitingManual === 0 && (
        <Alert
          type="success"
          showIcon
          message="Every shot is rendered"
          description="Take it to Clip to trim and time it, then Export."
        />
      )}

      {state && (state.awaitingManual > 0 || state.failed > 0) && (
        <Alert
          type="warning"
          showIcon
          message={`${state.awaitingManual} shot(s) waiting on you, ${state.failed} failed`}
          description="The Pages and Presenter boards say why, and let you retry one at a time."
        />
      )}
    </Space>
  );
}
