'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Empty, Input, Row, Table, Tag, Typography } from 'antd';

type Node = { id: string; type: 'post' | 'chapter' | 'topic'; label: string; slug: string | null; weight: number };
type Edge = { src: string; dst: string; rel: string };

const COLOR = { post: '#7c5cff', chapter: '#3ec5ff', topic: '#3ddc97' } as const;

export default function GraphPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Node | null>(null);

  useEffect(() => {
    fetch('/api/graph').then((r) => r.json()).then((d) => { setNodes(d.nodes ?? []); setEdges(d.edges ?? []); });
  }, []);

  // Radial layout: posts on an inner ring, their topics on an outer ring.
  const layout = useMemo(() => {
    const posts = nodes.filter((n) => n.type === 'post');
    const topics = nodes.filter((n) => n.type === 'topic').slice(0, 90);
    const pos = new Map<string, { x: number; y: number; n: Node }>();
    posts.forEach((n, i) => {
      const a = (i / Math.max(posts.length, 1)) * Math.PI * 2 - Math.PI / 2;
      pos.set(n.id, { x: 500 + Math.cos(a) * 150, y: 360 + Math.sin(a) * 110, n });
    });
    topics.forEach((n, i) => {
      const a = (i / Math.max(topics.length, 1)) * Math.PI * 2 - Math.PI / 2;
      pos.set(n.id, { x: 500 + Math.cos(a) * 330, y: 360 + Math.sin(a) * 250, n });
    });
    return pos;
  }, [nodes]);

  const visibleEdges = edges.filter((e) => layout.has(e.src) && layout.has(e.dst));
  const match = (n: Node) => !q || n.label.toLowerCase().includes(q.toLowerCase());

  const topicRows = nodes
    .filter((n) => n.type === 'topic' && match(n))
    .map((n) => ({
      key: n.id,
      label: n.label,
      weight: n.weight,
      posts: edges.filter((e) => e.dst === n.id && e.rel === 'covers').length,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 40);

  return (
    <div>
      <Typography.Title level={4}>Knowledge graph</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -6 }}>
        Every book chapter and slide heading is indexed in SQLite. Shared topics link posts together, so the planner can
        see what has already been covered.
      </Typography.Paragraph>

      <Input.Search
        placeholder="Search topics…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ maxWidth: 360, marginBottom: 14 }}
        allowClear
      />

      {nodes.length === 0 ? (
        <Empty description="Graph is empty — create a post and build its book" />
      ) : (
        <Row gutter={16}>
          <Col span={15}>
            <Card size="small" styles={{ body: { padding: 0 } }}>
              <svg viewBox="0 0 1000 720" style={{ width: '100%', height: 560, display: 'block' }}>
                {visibleEdges.map((e, i) => {
                  const a = layout.get(e.src)!;
                  const b = layout.get(e.dst)!;
                  return (
                    <line
                      key={i}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={e.rel === 'shares_topic' ? '#ff7eb6' : 'rgba(128,128,160,.35)'}
                      strokeWidth={e.rel === 'shares_topic' ? 1.6 : 0.9}
                    />
                  );
                })}
                {[...layout.values()].map(({ x, y, n }) => {
                  const r = n.type === 'post' ? 12 : Math.min(4 + n.weight, 10);
                  const dim = q && !match(n);
                  return (
                    <g key={n.id} onClick={() => setSelected(n)} style={{ cursor: 'pointer', opacity: dim ? 0.15 : 1 }}>
                      <circle cx={x} cy={y} r={r} fill={COLOR[n.type]} stroke="#0f1016" strokeWidth={1.5} />
                      {(n.type === 'post' || n.weight > 1 || q) && (
                        <text x={x} y={y - r - 5} textAnchor="middle" fontSize={n.type === 'post' ? 12 : 9} fill="currentColor">
                          {n.label.length > 26 ? n.label.slice(0, 26) + '…' : n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </Card>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <Tag color="purple">post</Tag><Tag color="cyan">chapter</Tag><Tag color="green">topic</Tag>
              <Tag color="magenta">pink line = posts sharing a topic</Tag>
            </div>
          </Col>

          <Col span={9}>
            {selected && (
              <Card size="small" title={selected.label} style={{ marginBottom: 12 }} extra={<Tag>{selected.type}</Tag>}>
                {selected.slug && <div style={{ fontSize: 12 }}>post: <b>{selected.slug}</b></div>}
                <div style={{ fontSize: 12 }}>mentions: {selected.weight}</div>
              </Card>
            )}
            <Card size="small" title={`Topics (${topicRows.length})`} styles={{ body: { padding: 0 } }}>
              <Table
                size="small"
                pagination={false}
                scroll={{ y: 420 }}
                dataSource={topicRows}
                columns={[
                  { title: 'Topic', dataIndex: 'label' },
                  { title: 'Mentions', dataIndex: 'weight', width: 90 },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
