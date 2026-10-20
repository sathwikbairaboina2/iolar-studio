'use client';
import React from 'react';
import { Button, Card, Input, InputNumber, Space, Typography } from 'antd';
import type { Script } from '@/lib/explainer2/schema';

/**
 * The script as a form: title, the hook's two readings, each beat's caption, narration and visual, and the facts.
 * The limits shown are the schema's own, and the server checks them again on save.
 */

const LIMITS = { title: 40, caption: 80, narration: 220 };

function Reading({ label, value, onChange }: { label: string; value: Script['hook']['before']; onChange: (v: Script['hook']['before']) => void }) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input prefix={<Typography.Text type="secondary">{label}</Typography.Text>} value={value.label} maxLength={40} onChange={(e) => onChange({ ...value, label: e.target.value })} />
      <InputNumber value={value.value} onChange={(v) => onChange({ ...value, value: Number(v ?? 0) })} style={{ width: 130 }} />
      <Input value={value.unit} maxLength={12} placeholder="unit" onChange={(e) => onChange({ ...value, unit: e.target.value })} style={{ width: 90 }} />
    </Space.Compact>
  );
}

export default function ScriptEditor({ script, disabled, saving, onSave }: { script: Script; disabled: boolean; saving: boolean; onSave: (s: Script) => void }) {
  // `edit` holds a draft with the script it was typed against; a reload hands back a new object and so drops the draft.
  const [edit, setEdit] = React.useState<{ against: Script; draft: Script } | null>(null);
  const dirty = !!edit && edit.against === script;
  const draft = dirty ? edit!.draft : script;
  const set = (next: Script) => setEdit({ against: script, draft: next });
  const setBeat = (i: number, patch: Partial<Script['beats'][number]>) =>
    set({ ...draft, beats: draft.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  return (
    <Card size="small" title="Script" extra={
      <Button type="primary" size="small" disabled={disabled || !dirty} loading={saving} onClick={() => onSave(draft)}>Save script</Button>
    }>
      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        <Input prefix={<Typography.Text type="secondary">Title</Typography.Text>} value={draft.title} maxLength={LIMITS.title} showCount onChange={(e) => set({ ...draft, title: e.target.value })} />
        <Reading label="Before" value={draft.hook.before} onChange={(before) => set({ ...draft, hook: { ...draft.hook, before } })} />
        <Reading label="After" value={draft.hook.after} onChange={(after) => set({ ...draft, hook: { ...draft.hook, after } })} />
        {draft.beats.map((b, i) => (
          <Card key={b.id} size="small" type="inner" title={`${b.id}${i === 0 ? '  ·  hook' : ''}`}>
            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
              <Input prefix={<Typography.Text type="secondary">Caption</Typography.Text>} value={b.caption} maxLength={LIMITS.caption} showCount onChange={(e) => setBeat(i, { caption: e.target.value })} />
              <Input.TextArea value={b.narration} maxLength={LIMITS.narration} showCount autoSize={{ minRows: 2, maxRows: 4 }} onChange={(e) => setBeat(i, { narration: e.target.value })} />
              <Input prefix={<Typography.Text type="secondary">On screen</Typography.Text>} value={b.visual} onChange={(e) => setBeat(i, { visual: e.target.value })} />
              {/* Committed on blur: a comma typed in the middle of a list must not be filtered away while typing. */}
              <Input
                key={`${i}-${(script.beats[i]?.emphasis ?? []).join('|')}`}
                prefix={<Typography.Text type="secondary">Highlight</Typography.Text>}
                placeholder="numbers and key terms in the narration, comma separated"
                defaultValue={(b.emphasis ?? []).join(', ')}
                onBlur={(e) => {
                  const next = e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
                  if (next.join('|') !== (b.emphasis ?? []).join('|')) setBeat(i, { emphasis: next });
                }}
              />
            </Space>
          </Card>
        ))}
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Facts the narration relies on (one per line)</Typography.Text>
          <Input.TextArea
            value={draft.facts.join('\n')}
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(e) => set({ ...draft, facts: e.target.value.split('\n').filter((l) => l.trim()) })}
          />
        </div>
      </Space>
    </Card>
  );
}
