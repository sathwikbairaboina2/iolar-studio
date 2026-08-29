'use client';
import { Button, Card, Input, Select, Space } from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined, CopyOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { Block } from '@/lib/schema';

const { TextArea } = Input;

const INK_OPTS = ['blue', 'red', 'green', 'black', 'accent'].map((v) => ({ value: v }));
const CALLOUT_OPTS = ['tip', 'takeaway', 'cloud'].map((v) => ({ value: v }));
const DIAGRAM_OPTS = ['flow', 'memory-cells', 'tree', 'compare'].map((v) => ({ value: v }));

function lines(s: string): string[] {
  return s.split('\n').filter((l) => l.trim().length > 0);
}

export default function BlockForm({
  block, index, total, onChange, onMove, onDuplicate, onDelete,
}: {
  block: Block;
  index: number;
  total: number;
  onChange: (b: Block) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const set = (patch: Partial<Block>) => onChange({ ...block, ...patch } as Block);

  let body: React.ReactNode = null;
  switch (block.type) {
    case 'heading':
      body = (
        <Space.Compact block>
          <Input value={block.text} onChange={(e) => set({ text: e.target.value })} placeholder="Heading text" />
          <Select value={block.ink ?? 'blue'} options={INK_OPTS} onChange={(ink) => set({ ink })} style={{ width: 110 }} />
        </Space.Compact>
      );
      break;
    case 'paragraph':
      body = <TextArea rows={3} value={block.text} onChange={(e) => set({ text: e.target.value })} placeholder="Paragraph text" />;
      break;
    case 'bullets':
      body = (
        <TextArea
          rows={4}
          value={block.items.join('\n')}
          onChange={(e) => set({ items: e.target.value.split('\n') })}
          onBlur={(e) => set({ items: lines(e.target.value) })}
          placeholder="One bullet per line"
        />
      );
      break;
    case 'sidebox':
      body = (
        <>
          <Space.Compact block style={{ marginBottom: 8 }}>
            <Input value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Box title" />
            <Select value={block.ink ?? 'green'} options={INK_OPTS} onChange={(ink) => set({ ink })} style={{ width: 110 }} />
          </Space.Compact>
          <TextArea
            rows={4}
            value={block.items.join('\n')}
            onChange={(e) => set({ items: e.target.value.split('\n') })}
            onBlur={(e) => set({ items: lines(e.target.value) })}
            placeholder="One item per line"
          />
        </>
      );
      break;
    case 'table': {
      const setCell = (r: number, c: number, v: string) => {
        if (r === -1) {
          const headers = [...block.headers]; headers[c] = v; set({ headers });
        } else {
          const rows = block.rows.map((row) => [...row]); rows[r][c] = v; set({ rows });
        }
      };
      body = (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${block.headers.length}, 1fr)`, gap: 4 }}>
            {block.headers.map((h, c) => (
              <Input key={`h${c}`} size="small" value={h} style={{ fontWeight: 600 }} onChange={(e) => setCell(-1, c, e.target.value)} />
            ))}
            {block.rows.map((row, r) => row.map((cell, c) => (
              <Input key={`${r}-${c}`} size="small" value={cell} onChange={(e) => setCell(r, c, e.target.value)} />
            )))}
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => set({ rows: [...block.rows, block.headers.map(() => '')] })}>+ row</Button>
            <Button size="small" onClick={() => set({ headers: [...block.headers, ''], rows: block.rows.map((r) => [...r, '']) })}>+ col</Button>
            <Button size="small" danger disabled={block.rows.length <= 1} onClick={() => set({ rows: block.rows.slice(0, -1) })}>- row</Button>
          </Space>
        </>
      );
      break;
    }
    case 'code':
      body = (
        <>
          <Input size="small" value={block.lang} onChange={(e) => set({ lang: e.target.value })} style={{ width: 140, marginBottom: 6 }} placeholder="language" />
          <TextArea
            rows={4}
            value={block.lines.join('\n')}
            onChange={(e) => set({ lines: e.target.value.split('\n') })}
            style={{ fontFamily: 'monospace' }}
            placeholder="code lines"
          />
        </>
      );
      break;
    case 'callout':
      body = (
        <>
          <Space.Compact block style={{ marginBottom: 8 }}>
            <Select value={block.style} options={CALLOUT_OPTS} onChange={(style) => set({ style })} style={{ width: 130 }} />
            <Input value={block.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" />
          </Space.Compact>
          <TextArea rows={2} value={block.text} onChange={(e) => set({ text: e.target.value })} placeholder="Callout text" />
        </>
      );
      break;
    case 'qa':
      body = (
        <>
          <Input value={block.q} onChange={(e) => set({ q: e.target.value })} placeholder="Question" style={{ marginBottom: 6 }} />
          <TextArea
            rows={3}
            value={block.a_bullets.join('\n')}
            onChange={(e) => set({ a_bullets: e.target.value.split('\n') })}
            onBlur={(e) => set({ a_bullets: lines(e.target.value) })}
            placeholder="Answer bullets, one per line"
            style={{ marginBottom: 6 }}
          />
          <TextArea
            rows={2}
            value={(block.example_code ?? []).join('\n')}
            onChange={(e) => set({ example_code: e.target.value.split('\n') })}
            onBlur={(e) => set({ example_code: lines(e.target.value) })}
            style={{ fontFamily: 'monospace' }}
            placeholder="Example code (optional)"
          />
        </>
      );
      break;
    case 'diagram': {
      let specText: string;
      try { specText = JSON.stringify(block.spec); } catch { specText = '{}'; }
      body = (
        <>
          <Select value={block.kind} options={DIAGRAM_OPTS} onChange={(kind) => set({ kind })} style={{ width: 160, marginBottom: 6 }} />
          <TextArea
            rows={2}
            defaultValue={specText}
            onBlur={(e) => {
              try { set({ spec: JSON.parse(e.target.value) }); } catch { /* keep old spec on bad JSON */ }
            }}
            style={{ fontFamily: 'monospace' }}
            placeholder='{"nodes": ["a", "b"]}'
          />
        </>
      );
      break;
    }
  }

  return (
    <Card
      size="small"
      style={{ marginBottom: 10 }}
      title={<span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{block.type}</span>}
      extra={
        <Space size={2}>
          <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => onMove(-1)} aria-label="move up" />
          <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === total - 1} onClick={() => onMove(1)} aria-label="move down" />
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onDuplicate} aria-label="duplicate" />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label="delete block" />
        </Space>
      }
    >
      {body}
    </Card>
  );
}
