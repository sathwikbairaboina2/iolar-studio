'use client';
import React, { useState } from 'react';
import { Button, Input, Space, Tooltip, message } from 'antd';
import { RedoOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import type { Beat } from '@/lib/reel/schema';

/**
 * What to do about one shot that is not going to arrive on its own.
 *
 * Retry it with a better brief, recast it as the kind the other renderer makes, or stop
 * waiting on a job the renderer has forgotten and hand the beat to yourself. Each is one
 * request about one beat — none of them sweeps up the rest of the reel.
 */

type Kind = Beat['shot']['kind'];
type Props = {
  slug: string;
  beatId: string;
  kind: Kind;
  brief: string;
  status?: string;
  onChanged?: () => void;
};

export default function ShotActions({ slug, beatId, kind, brief, status, onChanged }: Props) {
  const [text, setText] = useState(brief);
  const [busy, setBusy] = useState<string | null>(null);
  const other: Kind = kind === 'screen' ? 'talking-head' : 'screen';

  const send = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const r = await fetch(`/api/reel/${slug}/shots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beatId, ...body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${label} failed`);
      message.success(`${label} done`);
      onChanged?.();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Space wrap>
      <Input
        data-testid="shot-brief"
        size="small"
        style={{ width: 260 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="what this shot should show"
      />
      <Button
        data-testid="shot-retry"
        size="small"
        icon={<RedoOutlined />}
        loading={busy === 'retry'}
        onClick={() => send({ action: 'retry', brief: text }, 'retry')}
      >
        Retry
      </Button>
      <Tooltip title={`Render this beat as a ${other} shot instead. It goes back through the gate unqueued.`}>
        <Button
          data-testid="shot-recast"
          size="small"
          icon={<SwapOutlined />}
          loading={busy === 'recast'}
          onClick={() => send({ action: 'recast', kind: other }, 'recast')}
        >
          Make it a {other === 'talking-head' ? 'talking head' : 'page shot'}
        </Button>
      </Tooltip>
      {!!status && status !== 'ready' && (
        <Tooltip title="Stop polling a job the renderer has forgotten, and drop your own file for it instead.">
          <Button
            data-testid="shot-abandon"
            size="small"
            danger
            icon={<StopOutlined />}
            loading={busy === 'abandon'}
            onClick={() => send({ action: 'abandon', why: 'abandoned in the studio' }, 'abandon')}
          >
            Give up on it
          </Button>
        </Tooltip>
      )}
    </Space>
  );
}
