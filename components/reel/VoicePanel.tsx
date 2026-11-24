'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Input, Space, Tag, Typography, Upload } from 'antd';
import { message } from '@/lib/ui/message';
import { AudioOutlined, CopyOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';

/**
 * The voiceover stage, with the creator in it.
 *
 * One take covers the whole script — beats are cut out of it afterwards, not recorded into
 * it — so there are exactly three ways to get one: speak it on this machine, hand over a
 * take made somewhere better, or re-align the take already on disk. Whichever arrives, the
 * words are aligned before anything else runs: a build on a previous take's timings is
 * silent, plausible and wrong.
 */

export type VoiceStatus = {
  hasAudio: boolean;
  bytes: number;
  aligned: boolean;
  durationSec: number;
  heardWords: number;
  scriptWords: number;
  matchesScript?: boolean;
  script: string;
  provider?: string | null;
  voiceId?: string | null;
};

type Props = { slug: string; onVoice?: () => void };

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);

export default function VoicePanel({ slug, onVoice }: Props) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/voice`).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d && typeof d.script === 'string') setStatus(d as VoiceStatus);
  }, [slug]);

  useEffect(() => {
    // The panel asks the server where the voiceover stands; it holds no state of its own.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const speak = async (body: unknown, label: string) => {
    setBusy(label);
    try {
      const r = await fetch(`/api/reel/${slug}/voice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${label} failed`);
      message.success(`${label} done`);
      onVoice?.();
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const put = await fetch(`/api/reel/${slug}/vo`, { method: 'PUT', body: file });
      const d = await put.json();
      // Aligning audio the reel never took would time the build against the previous take.
      if (!put.ok) throw new Error(d.error ?? 'the reel would not take that audio');
      message.success(`took ${file.name}`);
      await speak({ alignOnly: true }, 'align');
    } catch (err) {
      message.error(String(err));
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.script);
      message.success('script copied');
    } catch {
      message.error('this browser would not give up the clipboard — select the script and copy it');
    }
  };

  const drift = status?.aligned && status.heardWords !== status.scriptWords;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        One take covers the whole script. Copy it, speak it wherever you like, and drop the file back —
        or let this machine say it.
      </Typography.Text>

      <Input.TextArea
        data-testid="voice-script"
        value={status?.script ?? ''}
        readOnly
        autoSize={{ minRows: 3, maxRows: 10 }}
      />

      <Space wrap>
        <Button data-testid="voice-copy" icon={<CopyOutlined />} onClick={copy} disabled={!status?.script}>
          Copy script
        </Button>
        <span data-testid="voice-upload">
        <Upload
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            void upload(file as unknown as File);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={busy === 'upload'}>
            Drop your own take
          </Button>
        </Upload>
        </span>
        <Button
          data-testid="voice-generate"
          icon={<AudioOutlined />}
          loading={busy === 'voice'}
          onClick={() => speak({}, 'voice')}
        >
          Speak it here
        </Button>
        <Button
          data-testid="voice-align"
          icon={<ReloadOutlined />}
          loading={busy === 'align'}
          disabled={!status?.hasAudio}
          onClick={() => speak({ alignOnly: true }, 'align')}
        >
          Re-align
        </Button>
      </Space>

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
        <Descriptions.Item label="Audio">
          {status?.hasAudio ? <Tag color="green">{kb(status.bytes)} on disk</Tag> : <Tag>none yet</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Aligned">
          {status?.aligned ? <Tag color="green">{status.heardWords} words</Tag> : <Tag color="orange">not yet</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Length">
          {status?.durationSec ? `${status.durationSec.toFixed(1)}s` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Script">{status?.scriptWords ?? 0} words</Descriptions.Item>
      </Descriptions>

      {status?.hasAudio && !status.aligned && (
        <Alert
          type="warning"
          showIcon
          title="This take has no word timings yet"
          description="Nothing can be cut against it until it is aligned. Re-align to give it timings."
        />
      )}

      {status?.aligned && status.matchesScript === false && (
        <Alert
          data-testid="voice-stale"
          type="warning"
          showIcon
          title="This take is of an older script"
          description="A beat has been rewritten since it was recorded. Speak it again, or drop a new take — until then the reel says one thing and the captions say another."
        />
      )}

      {drift && (
        <Alert
          data-testid="voice-drift"
          type="info"
          showIcon
          title={`The recogniser heard ${status!.heardWords} words where the script has ${status!.scriptWords}`}
          description="Captions still read the script — the alignment pairs the two and borrows timings for anything it missed. A large gap usually means the take is of a different script."
        />
      )}
    </Space>
  );
}
