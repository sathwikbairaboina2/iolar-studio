'use client';
import React from 'react';
import { Button, Card, Input, Select, Space, Tag, Typography } from 'antd';
import { rowsAt } from '@/lib/explainer/inspect';
import type { ExplainerDoc, Mutation } from '@/lib/explainer/schema';

/**
 * What the selected beat does, in order, with a way to add the kinds of change the node form
 * cannot express: a line of text, a panel line, a link between two rows.
 *
 * Everything here names a command. Nothing writes a document.
 */

const STATE_COLOUR: Record<string, string> = { idle: 'default', good: 'green', warn: 'orange', bad: 'red' };

/** A mutation as a sentence, because `{"op":"set","row":"db","value":2}` is not one. */
function read(m: Mutation): string {
  if (m.op === 'set') {
    const bits = [
      m.label !== undefined ? `label "${m.label}"` : null,
      m.value !== undefined ? `value ${m.value ?? 'none'}` : null,
      m.state !== undefined ? m.state : null,
      m.sub !== undefined ? `sub "${m.sub ?? ''}"` : null,
      m.icon !== undefined ? `icon ${m.icon}` : null,
      m.tier !== undefined ? `tier ${m.tier}` : null,
      m.col !== undefined ? `col ${m.col}` : null,
      m.unit !== undefined ? `unit "${m.unit}"` : null,
    ].filter(Boolean);
    return `${m.row} → ${bits.join(', ') || 'nothing'}`;
  }
  if (m.op === 'add') return `add "${m.row.id}" (${m.row.label})`;
  if (m.op === 'link') return `${m.from} → ${m.to}${m.label ? ` "${m.label}"` : ''}`;
  if (m.op === 'text') return `${m.field}: ${m.to === null ? 'cleared' : `"${m.to}"`}`;
  return `panel "${m.text}"`;
}

export default function MutationList({
  doc, beatId, busy, onRun,
}: {
  doc: ExplainerDoc | null;
  beatId: string | null;
  busy: boolean;
  onRun: (op: string, args: unknown) => Promise<boolean> | void;
}) {
  const [adding, setAdding] = React.useState<'panel' | 'text' | 'link' | null>(null);
  const [text, setText] = React.useState('');
  const [field, setField] = React.useState<'title' | 'subtitle' | 'note'>('note');
  const [from, setFrom] = React.useState<string | undefined>();
  const [to, setTo] = React.useState<string | undefined>();

  if (!doc || !beatId) return null;
  const beat = doc.beats.find((b) => b.id === beatId);
  if (!beat) return null;
  const rows = rowsAt(doc, beatId);

  const done = () => { setAdding(null); setText(''); setFrom(undefined); setTo(undefined); };

  const add = () => {
    if (adding === 'panel' && text.trim()) {
      void onRun('mutation.add', { beatId, mutation: { op: 'panel', text: text.trim().slice(0, 48) } });
    } else if (adding === 'text') {
      void onRun('mutation.add', {
        beatId,
        mutation: { op: 'text', field, to: text.trim() === '' ? null : text.trim().slice(0, 90) },
      });
    } else if (adding === 'link' && from && to) {
      void onRun('mutation.add', { beatId, mutation: { op: 'link', from, to } });
    }
    done();
  };

  return (
    <Card
      size="small"
      title={`What ${beat.id} changes`}
      styles={{ body: { padding: 0 } }}
      extra={
        <Select
          size="small"
          value={adding ?? undefined}
          placeholder="add…"
          style={{ width: 104 }}
          disabled={busy}
          onChange={(v) => setAdding(v)}
          options={[
            { label: 'panel line', value: 'panel' },
            { label: 'title/note', value: 'text' },
            { label: 'link', value: 'link' },
          ]}
        />
      }
    >
      {beat.mutations.length === 0 ? (
        <div style={{ padding: '10px 14px', fontSize: 12, opacity: 0.6 }}>
          Nothing yet — a beat that changes nothing is a still frame.
        </div>
      ) : (
        beat.mutations.map((m, i) => (
          <div
            key={`${i}-${m.op}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', fontSize: 12,
              borderBottom: '1px solid rgba(128,128,128,.12)',
            }}
          >
            <Tag color={m.op === 'set' ? STATE_COLOUR[('state' in m && m.state) || 'idle'] : 'default'} style={{ marginInlineEnd: 0 }}>
              {m.op}
            </Tag>
            <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }}>{read(m)}</span>
            <Button
              size="small"
              type="text"
              disabled={busy || i === 0}
              onClick={() => void onRun('mutation.move', { beatId, from: i, to: i - 1 })}
            >
              ↑
            </Button>
            <Button
              size="small"
              type="text"
              disabled={busy || i === beat.mutations.length - 1}
              onClick={() => void onRun('mutation.move', { beatId, from: i, to: i + 1 })}
            >
              ↓
            </Button>
            <Button
              size="small"
              type="text"
              danger
              disabled={busy}
              onClick={() => void onRun('mutation.remove', { beatId, index: i })}
            >
              ✕
            </Button>
          </div>
        ))
      )}

      {adding ? (
        <div style={{ padding: 12, borderTop: '1px solid rgba(128,128,128,.18)' }}>
          <Space orientation="vertical" size={8} style={{ width: '100%' }}>
            {adding === 'text' ? (
              <Select
                size="small"
                value={field}
                style={{ width: '100%' }}
                onChange={setField}
                options={[
                  { label: 'title', value: 'title' },
                  { label: 'subtitle', value: 'subtitle' },
                  { label: 'note', value: 'note' },
                ]}
              />
            ) : null}

            {adding === 'link' ? (
              <Space.Compact style={{ width: '100%' }}>
                <Select
                  size="small" placeholder="from" value={from} onChange={setFrom} style={{ width: '50%' }}
                  options={rows.map((r) => ({ label: r.id, value: r.id }))}
                />
                <Select
                  size="small" placeholder="to" value={to} onChange={setTo} style={{ width: '50%' }}
                  options={rows.map((r) => ({ label: r.id, value: r.id }))}
                />
              </Space.Compact>
            ) : (
              <Input
                size="small"
                placeholder={adding === 'panel' ? 'x-cache: HIT' : 'leave empty to clear it'}
                value={text}
                maxLength={adding === 'panel' ? 48 : 90}
                onChange={(e) => setText(e.target.value)}
                onPressEnter={add}
              />
            )}

            <Space>
              <Button size="small" type="primary" onClick={add} disabled={busy}>Add</Button>
              <Button size="small" onClick={done}>Cancel</Button>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {adding === 'panel' ? 'The panel holds four lines.' : null}
              </Typography.Text>
            </Space>
          </Space>
        </div>
      ) : null}
    </Card>
  );
}
