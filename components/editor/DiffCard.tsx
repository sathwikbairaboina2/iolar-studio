'use client';
import { Card, Tag, Typography } from 'antd';
import type { SlideDiff, BlockDiff } from '@/lib/ai/diff';
import type { Block } from '@/lib/schema';
import { stripInline } from '@/lib/renderer/inline';

function rawBlockText(b?: Block): string {
  if (!b) return '';
  switch (b.type) {
    case 'heading': case 'paragraph': return b.text;
    case 'bullets': return b.items.join(' · ');
    case 'sidebox': return `${b.title}: ${b.items.join(' · ')}`;
    case 'table': return `${b.headers.join(' | ')} (+${b.rows.length} rows)`;
    case 'code': return b.lines.join(' ⏎ ');
    case 'diagram': return `${b.kind} diagram`;
    case 'callout': return `${b.title}: ${b.text}`;
    case 'qa': return `${b.q} → ${b.a_bullets.join(' · ')}`;
  }
}

function blockText(b?: Block): string {
  return stripInline(rawBlockText(b));
}

function DiffLine({ d }: { d: BlockDiff }) {
  return (
    <div style={{ fontSize: 12, fontFamily: 'monospace', padding: '2px 0' }}>
      {d.before && (
        <div style={{ background: 'rgba(255,77,79,.12)', color: '#ff7875', padding: '2px 8px', borderRadius: 4 }}>
          - [{d.before.type}] {blockText(d.before)}
        </div>
      )}
      {d.after && (
        <div style={{ background: 'rgba(82,196,26,.12)', color: '#95de64', padding: '2px 8px', borderRadius: 4, marginTop: 2 }}>
          + [{d.after.type}] {blockText(d.after)}
        </div>
      )}
    </div>
  );
}

export default function DiffCard({ diff }: { diff: SlideDiff }) {
  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      title={
        <span style={{ fontSize: 12 }}>
          Slide {diff.slide} <Tag color={diff.kind === 'added' ? 'green' : diff.kind === 'removed' ? 'red' : 'blue'}>{diff.kind}</Tag>
        </span>
      }
    >
      {diff.titleChanged && (
        <Typography.Text style={{ fontSize: 12 }}>
          title: <del>{diff.titleChanged.before}</del> → <b>{diff.titleChanged.after}</b>
        </Typography.Text>
      )}
      {diff.blocks.map((b, i) => <DiffLine key={i} d={b} />)}
      {diff.kind === 'removed' && <Typography.Text type="danger" style={{ fontSize: 12 }}>slide removed</Typography.Text>}
    </Card>
  );
}
