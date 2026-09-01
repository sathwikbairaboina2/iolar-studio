'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Tag, Typography, Upload, message } from 'antd';
import { CopyOutlined, ExportOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';

/**
 * Where the reel changes hands.
 *
 * The studio makes the pieces; the cut is made in an editor. This sends everything over in
 * one folder — the recordings as they came back, the voice they were rendered against, the
 * script, and a project file that opens on the reel as it stands — and takes the finished
 * file back afterwards.
 */

type State = { dir: string; handedOverAt: string; clips: string[] } | null;

type Props = { slug: string; onReturned?: () => void };

export default function Handoff({ slug, onReturned }: Props) {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/handoff`).catch(() => null);
    const d = await r?.json().catch(() => null);
    setState(d && Array.isArray(d.clips) ? (d as NonNullable<State>) : null);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const send = async () => {
    setBusy('send');
    try {
      const r = await fetch(`/api/reel/${slug}/handoff`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'nothing could be handed over');
      message.success(`${d.clips} clips, the voice and the script are in the edit folder`);
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const takeBack = async (file: File) => {
    setBusy('return');
    try {
      const r = await fetch(`/api/reel/${slug}/handoff`, { method: 'PUT', body: file });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'the studio would not take that file');
      message.success(`${file.name} is now this reel's cut`);
      onReturned?.();
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const copyPath = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.dir);
      message.success('folder path copied');
    } catch {
      message.error('this browser would not give up the clipboard — the path is above');
    }
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Typography.Text type="secondary">
        The studio makes the pieces. Cutting happens in an editor — send everything over, cut it in
        Shotcut or Kdenlive, then bring the finished file back here.
      </Typography.Text>

      <div data-testid="handoff-state">
        {state ? (
          <Space orientation="vertical" size={4}>
            <Space wrap>
              <Tag color="green">{state.clips.length} clips</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                sent {new Date(state.handedOverAt).toLocaleString()}
              </Typography.Text>
            </Space>
            <Button data-testid="handoff-path" size="small" icon={<CopyOutlined />} onClick={copyPath}>
              <Typography.Text code style={{ fontSize: 12 }}>
                {state.dir}
              </Typography.Text>
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Open <Typography.Text code>project.mlt</Typography.Text> in Shotcut or Kdenlive.
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">This reel has not been handed over yet.</Typography.Text>
        )}
      </div>

      <Space wrap>
        <Button
          data-testid="handoff-send"
          type={state ? 'default' : 'primary'}
          icon={<ExportOutlined />}
          loading={busy === 'send'}
          onClick={send}
        >
          {state ? 'Send again' : 'Send to editor'}
        </Button>
        <span data-testid="handoff-return">
          <Upload accept="video/mp4,.mp4,.mov" maxCount={1} showUploadList={false} beforeUpload={(f) => { void takeBack(f as unknown as File); return false; }}>
            <Button icon={<UploadOutlined />} loading={busy === 'return'} disabled={!state}>
              Bring the cut back
            </Button>
          </Upload>
        </span>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </Space>

      {state && (
        <div data-testid="handoff-clips">
          <Space orientation="vertical" size={2}>
            {state.clips.map((c) => (
              <Typography.Text key={c} style={{ fontSize: 12 }} type="secondary">
                {c}
              </Typography.Text>
            ))}
          </Space>
        </div>
      )}

      {state && (
        <Alert
          type="info"
          showIcon
          title="Sending again rebuilds the folder"
          description="The clips are copied fresh from whatever has rendered since. Anything you saved inside the edit folder is replaced, so keep your project file elsewhere once you start cutting."
        />
      )}
    </Space>
  );
}
