'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { BeatInbox } from '@/lib/reel/inbox';

/**
 * The beat folders, seen from the studio.
 *
 * Filling them happens outside the browser — that is the point — so the panel's job is to
 * hand over the path, show what has landed, and take a file when you pick it.
 */

type Props = { slug: string; onAdopted?: () => void };

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);

export default function InboxPanel({ slug, onAdopted }: Props) {
  const [boxes, setBoxes] = useState<BeatInbox[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/reel/${slug}/inbox`).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (Array.isArray(d?.inbox)) setBoxes(d.inbox as BeatInbox[]);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const adopt = async (beatId: string, name: string, kind: 'video' | 'image') => {
    const key = `${beatId}:${name}`;
    setBusy(key);
    try {
      const r = await fetch(`/api/reel/${slug}/inbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A video is the shot. An image taken here is meant as the shot too — a still to
        // seed a renderer with is chosen on the beat itself, not out of a folder.
        body: JSON.stringify({ beatId, name, role: 'shot' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'that file would not attach');
      message.success(`${name} is now ${beatId}'s ${kind === 'video' ? 'shot' : 'picture'}`);
      onAdopted?.();
      await refresh();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  const copyPath = async (dir: string) => {
    try {
      await navigator.clipboard.writeText(dir);
      message.success('folder path copied');
    } catch {
      message.error('this browser would not give up the clipboard');
    }
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space>
        <Typography.Text type="secondary">
          One folder per beat. Drop your own clips or stills in from anywhere, then take the one you want.
        </Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </Space>

      {(boxes ?? []).map((box) => (
        <Card key={box.beatId} size="small" data-testid={`inbox-${box.beatId}`} title={box.beatId}>
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            <Button
              data-testid={`inbox-path-${box.beatId}`}
              size="small"
              icon={<CopyOutlined />}
              onClick={() => void copyPath(box.dir)}
            >
              <Typography.Text code style={{ fontSize: 12 }}>
                {box.dir}
              </Typography.Text>
            </Button>

            {box.files.length === 0 ? (
              <Typography.Text type="secondary">Nothing dropped in yet.</Typography.Text>
            ) : (
              box.files.map((f) => (
                <Space key={f.name} wrap>
                  <Tag color={f.kind === 'video' ? 'blue' : 'purple'}>{f.kind}</Tag>
                  <Typography.Text>{f.name}</Typography.Text>
                  <Typography.Text type="secondary">{size(f.bytes)}</Typography.Text>
                  <Button
                    data-testid={`inbox-take-${box.beatId}-${f.name}`}
                    size="small"
                    loading={busy === `${box.beatId}:${f.name}`}
                    onClick={() => adopt(box.beatId, f.name, f.kind)}
                  >
                    Use this
                  </Button>
                </Space>
              ))
            )}
          </Space>
        </Card>
      ))}

      {boxes?.length === 0 && <Empty description="This reel has no beats yet." />}
    </Space>
  );
}
