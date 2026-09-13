'use client';
import React from 'react';
import { Alert, Button, Card, Input, InputNumber, Segmented, Select, Space, Typography } from 'antd';
import LabeledInput, { FieldLabel, flatStart } from '@/components/ui/LabeledInput';
import { editRow, rowAt, type RowPatch } from '@/lib/explainer/inspect';
import { ICONS, ROW_STATES, type ExplainerDoc } from '@/lib/explainer/schema';

/**
 * The selected node, as a form.
 *
 * Where an edit lands depends on where you are standing, and this says so out loud: on the first
 * beat a field belongs to the scene, and on any later beat it is a change that beat makes. The
 * decision itself is `lib/explainer/inspect.ts`, which is tested; this only shows it.
 */

export default function RowInspector({
  doc, beatId, rowId, busy, onRun, onClose,
}: {
  doc: ExplainerDoc | null;
  beatId: string | null;
  rowId: string | null;
  busy: boolean;
  onRun: (op: string, args: unknown) => Promise<boolean> | void;
  onClose: () => void;
}) {
  if (!doc || !beatId || !rowId) return null;
  const row = rowAt(doc, beatId, rowId);
  if (!row) {
    return (
      <Card size="small" title="Node">
        <Alert type="info" showIcon title={`"${rowId}" is not on the board at ${beatId}`} />
      </Card>
    );
  }

  const first = doc.beats[0]?.id === beatId;
  const write = (patch: RowPatch) => {
    const edit = editRow(doc, beatId, rowId, patch);
    if (edit) void onRun(edit.op, edit.args);
  };

  return (
    <Card
      size="small"
      title={`Node "${row.id}"`}
      extra={<Button size="small" type="text" onClick={onClose}>close</Button>}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        {first
          ? 'On the first beat, so this edits the board as it opens.'
          : `On ${beatId}, so this edits what ${beatId} changes about it.`}
      </Typography.Text>

      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <LabeledInput
          size="small"
          label="label"
          maxLength={28}
          defaultValue={row.label}
          key={`label-${beatId}-${rowId}-${row.label}`}
          disabled={busy}
          onBlur={(e) => e.target.value !== row.label && write({ label: e.target.value })}
          onPressEnter={(e) => write({ label: (e.target as HTMLInputElement).value })}
        />

        <Space.Compact style={{ width: '100%' }}>
          <InputNumber
            size="small"
            placeholder="value"
            value={row.value}
            disabled={busy}
            style={{ width: '55%' }}
            onChange={(v) => write({ value: v === null ? null : Number(v) })}
          />
          <Input
            size="small"
            placeholder="unit"
            maxLength={8}
            defaultValue={row.unit}
            key={`unit-${beatId}-${rowId}-${row.unit}`}
            disabled={busy}
            style={{ width: '45%' }}
            onBlur={(e) => e.target.value !== row.unit && write({ unit: e.target.value })}
          />
        </Space.Compact>

        <LabeledInput
          size="small"
          label="sub"
          maxLength={40}
          defaultValue={row.sub ?? ''}
          key={`sub-${beatId}-${rowId}-${row.sub ?? ''}`}
          disabled={busy}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== (row.sub ?? '')) write({ sub: next === '' ? null : next });
          }}
        />

        <Segmented
          size="small"
          block
          value={row.state}
          disabled={busy}
          options={ROW_STATES.map((s) => ({ label: s, value: s }))}
          onChange={(v) => write({ state: v as (typeof ROW_STATES)[number] })}
        />

        <Space size={8} style={{ width: '100%' }}>
          <Space.Compact>
            <FieldLabel size="small">tier</FieldLabel>
            <InputNumber
              size="small"
              min={0}
              max={3}
              value={row.tier}
              disabled={busy}
              onChange={(v) => v !== null && write({ tier: Number(v) })}
              style={{ width: 72, ...flatStart }}
            />
          </Space.Compact>
          <Space.Compact>
            <FieldLabel size="small">col</FieldLabel>
            <InputNumber
              size="small"
              min={0}
              max={5}
              value={row.col}
              disabled={busy}
              onChange={(v) => v !== null && write({ col: Number(v) })}
              style={{ width: 72, ...flatStart }}
            />
          </Space.Compact>
          <Select
            size="small"
            value={row.icon}
            disabled={busy}
            style={{ width: 110 }}
            options={ICONS.map((i) => ({ label: i, value: i }))}
            onChange={(v) => write({ icon: v })}
          />
        </Space>

        {first ? (
          <Button
            size="small"
            danger
            block
            disabled={busy || doc.scene.rows.length <= 2}
            onClick={() => { void onRun('scene.row.remove', { rowId }); onClose(); }}
          >
            Remove this row from the board
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
