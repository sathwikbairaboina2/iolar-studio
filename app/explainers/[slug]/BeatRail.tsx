'use client';
import React from 'react';
import { Button, InputNumber, Segmented, Space, Tooltip, Typography } from 'antd';
import { ROLES, type Role } from '@/lib/explainer/schema';
import type { Step } from './useExplainerEditor';

/**
 * The beats as a rail, each segment as wide as the beat is long.
 *
 * A list of beats hides the one thing anyone actually tunes. A rail where a six-second payoff is
 * three times the width of a two-second step shows the shape of the reel at a glance, and makes
 * the length the thing you click on.
 */

const ROLE_COLOUR: Record<string, string> = {
  hook: '#eb2f96', step: '#1677ff', payoff: '#52c41a', cta: '#faad14',
};

export default function BeatRail({
  steps, selected, busy, onSelect, onRun,
}: {
  steps: Step[];
  selected: number;
  busy: boolean;
  onSelect: (index: number) => void;
  onRun: (op: string, args: unknown) => Promise<boolean> | void;
}) {
  const total = steps.reduce((sum, s) => sum + s.durationFrames, 0) || 1;
  const step = steps[selected] ?? null;
  const seconds = step ? Math.round((step.durationFrames / 30) * 10) / 10 : 0;

  return (
    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 4, width: '100%' }}>
        {steps.map((s, i) => (
          <Tooltip key={s.id} title={`${s.id} · ${s.role} · ${(s.durationFrames / 30).toFixed(1)}s`}>
            <div
              onClick={() => onSelect(i)}
              style={{
                // Width in proportion to length: this is the whole point of a rail.
                flexGrow: s.durationFrames / total,
                flexBasis: 0,
                minWidth: 26,
                cursor: 'pointer',
                padding: '10px 8px 8px',
                borderRadius: 8,
                background: i === selected ? `${ROLE_COLOUR[s.role]}26` : 'rgba(128,128,128,.08)',
                borderTop: `3px solid ${ROLE_COLOUR[s.role] ?? '#888'}`,
                outline: i === selected ? `1px solid ${ROLE_COLOUR[s.role]}` : 'none',
                overflow: 'hidden',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.id}</div>
              <div style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
                {(s.durationFrames / 30).toFixed(1)}s · {s.mutations}
              </div>
            </div>
          </Tooltip>
        ))}
      </div>

      {step ? (
        <Space wrap size={8}>
          <Segmented
            size="small"
            value={step.role}
            onChange={(v) => void onRun('beat.role', { beatId: step.id, role: v as Role })}
            options={ROLES.map((r) => ({ label: r, value: r }))}
            disabled={busy}
          />
          <InputNumber
            size="small"
            min={0.5}
            max={30}
            step={0.5}
            value={seconds}
            disabled={busy}
            onChange={(v) => v !== null && void onRun('beat.sec', { beatId: step.id, sec: Number(v) })}
            suffix="s"
            style={{ width: 96 }}
          />
          <Tooltip title="Back to the default length for this role">
            <Button size="small" disabled={busy} onClick={() => void onRun('beat.sec', { beatId: step.id, sec: null })}>
              auto
            </Button>
          </Tooltip>
          <Button size="small" disabled={busy} onClick={() => void onRun('beat.add', { role: 'step', after: step.id })}>
            + beat after
          </Button>
          <Button size="small" disabled={busy || selected === 0} onClick={() => void onRun('beat.move', { beatId: step.id, toIndex: selected - 1 })}>
            ←
          </Button>
          <Button size="small" disabled={busy || selected >= steps.length - 1} onClick={() => void onRun('beat.move', { beatId: step.id, toIndex: selected + 1 })}>
            →
          </Button>
          <Button
            size="small"
            danger
            disabled={busy || steps.length <= 2}
            onClick={() => void onRun('beat.remove', { beatId: step.id })}
          >
            remove
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {(total / 30).toFixed(1)}s in total
          </Typography.Text>
        </Space>
      ) : null}
    </Space>
  );
}
