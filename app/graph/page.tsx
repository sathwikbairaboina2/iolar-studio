'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Input, List, Tabs, Tag, Typography } from 'antd';
import GraphCanvas from '@/components/graph/GraphCanvas';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';

/**
 * One page, four tabs, one space at a time. The second search box is the meaning search
 * the research agents use, shown here so what they would see is never a mystery.
 */

type SpaceKey = 'handbooks' | 'reels' | 'jobs' | 'all';
type Hit = { collection: string; score: number; text: string; payload: Record<string, unknown> };

export default function GraphPage() {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceKey>('handbooks');
  const [nodes, setNodes] = useState<ViewNode[]>([]);
  const [edges, setEdges] = useState<ViewEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ViewNode | null>(null);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [found, setFound] = useState<ViewNode[]>([]);

  const load = useCallback(async (s: SpaceKey) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/graph?space=${s}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `answered ${r.status}`);
        setNodes([]);
        setEdges([]);
        return;
      }
      setError(null);
      setNodes(d.nodes ?? []);
      setEdges(d.edges ?? []);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(space);
  }, [space, load]);

  const search = async () => {
    if (!q) {
      setFound([]);
      return;
    }
    const r = await fetch(`/api/graph?space=${space}&q=${encodeURIComponent(q)}`);
    const d = await r.json();
    setFound(d.nodes ?? []);
  };
  const askByMeaning = async () => {
    if (!ask) {
      setHits([]);
      return;
    }
    const r = await fetch(`/api/graph?space=${space}&ask=${encodeURIComponent(ask)}`);
    const d = await r.json();
    setHits(d.hits ?? []);
  };

  return (
    <div>
      <Typography.Title level={4}>Knowledge graph</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -6 }}>
        One graph, one space per category, shared topics and sources between them. The research agents read the same
        stores.
      </Typography.Paragraph>

      {error && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="The knowledge graph is not answering"
          description={
            <span>
              {error}. Start Neo4j from <a onClick={() => router.push('/plugins')}>Plugins</a>.
            </span>
          }
        />
      )}

      <Tabs
        activeKey={space}
        onChange={(k) => {
          setSpace(k as SpaceKey);
          setSelected(null);
          setFound([]);
          setHits([]);
        }}
        items={[
          { key: 'handbooks', label: 'Handbooks' },
          { key: 'reels', label: 'Reels' },
          { key: 'jobs', label: 'Jobs' },
          { key: 'all', label: 'All' },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <div>
          {!loading && !error && nodes.length === 0 && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {space === 'all'
                ? 'Nothing links two spaces yet. A topic covered by a chapter and a reel, or an employer a reel is about, would appear here.'
                : 'Nothing indexed in this space yet. Run npm run reindex:knowledge -- --wipe.'}
            </Typography.Text>
          )}
          <GraphCanvas nodes={nodes} edges={edges} onSelect={setSelected} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {nodes.length} nodes · {edges.length} edges · most connected first, capped at 400
          </Typography.Text>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Input.Search placeholder="search labels…" value={q} onChange={(e) => setQ(e.target.value)} onSearch={() => void search()} />
          {found.length > 0 && (
            <List
              size="small"
              dataSource={found}
              renderItem={(n) => (
                <List.Item onClick={() => setSelected(n)} style={{ cursor: 'pointer' }}>
                  <Tag>{n.kind}</Tag>
                  {n.label}
                </List.Item>
              )}
            />
          )}
          <Input
            placeholder="ask by meaning…"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void askByMeaning();
            }}
          />
          {hits.length > 0 && (
            <List
              size="small"
              dataSource={hits}
              renderItem={(h) => (
                <List.Item>
                  <Tag>{h.collection}</Tag>
                  <span style={{ fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>{h.score.toFixed(2)}</span>
                  {h.text.slice(0, 160)}
                </List.Item>
              )}
            />
          )}
          {selected && (
            <Card
              size="small"
              title={
                <span>
                  <Tag>{selected.kind}</Tag>
                  {selected.label}
                </span>
              }
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {selected.id} · degree {selected.degree} · space {selected.space}
              </Typography.Text>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
