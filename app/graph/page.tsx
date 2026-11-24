'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Input, Segmented, Tabs, Tag, Typography } from 'antd';
import dynamic from 'next/dynamic';
import GraphCanvas from '@/components/graph/GraphCanvas';
import type { ViewEdge, ViewNode } from '@/lib/knowledge/view';

/** three.js and a force layout are loaded the first time the deep view is opened, not before. */
const GraphCanvas3D = dynamic(() => import('@/components/graph/GraphCanvas3D'), {
  ssr: false,
  loading: () => <div style={{ height: 560, display: 'grid', placeItems: 'center', color: '#7b8798' }}>building the space…</div>,
});

/**
 * One page, five tabs, one space at a time. The second search box is the meaning search
 * the research agents use, shown here so what they would see is never a mystery.
 */

type SpaceKey = 'handbooks' | 'reels' | 'jobs' | 'explainers' | 'all';
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
  // Flat or deep. The choice is remembered, because it is a way of working rather than a mood.
  const [view, setView] = useState<'flat' | 'deep'>('flat');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem('iolar.graphView') === 'deep') setView('deep');
  }, []);

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
          { key: 'explainers', label: 'Explainers' },
          { key: 'all', label: 'All' },
        ]}
      />

      <div className="st-stack" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <div>
          {!loading && !error && nodes.length === 0 && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {space === 'all'
                ? 'Nothing links two spaces yet. A topic covered by a chapter and a reel, or an employer a reel is about, would appear here.'
                : 'Nothing indexed in this space yet. Run npm run reindex:knowledge -- --wipe.'}
            </Typography.Text>
          )}
          {view === 'deep' ? (
            <GraphCanvas3D nodes={nodes} edges={edges} onSelect={setSelected} />
          ) : (
            <GraphCanvas nodes={nodes} edges={edges} onSelect={setSelected} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {nodes.length} nodes · {edges.length} edges · most connected first, capped at 400
            </Typography.Text>
            <Segmented
              size="small"
              value={view}
              onChange={(v) => {
                const next = v as 'flat' | 'deep';
                setView(next);
                localStorage.setItem('iolar.graphView', next);
              }}
              options={[
                { label: 'Flat', value: 'flat' },
                { label: '3D', value: 'deep' },
              ]}
              data-testid="graph-view"
            />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Input.Search placeholder="search labels…" value={q} onChange={(e) => setQ(e.target.value)} onSearch={() => void search()} />
          {found.length > 0 && (
            <Rows>
              {found.map((n, i) => (
                <Row key={i} onClick={() => setSelected(n)}>
                  <Tag>{n.kind}</Tag>
                  {n.label}
                </Row>
              ))}
            </Rows>
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
            <Rows>
              {hits.map((h, i) => (
                <Row key={i}>
                  <Tag>{h.collection}</Tag>
                  <span style={{ fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>{h.score.toFixed(2)}</span>
                  {h.text.slice(0, 160)}
                </Row>
              ))}
            </Rows>
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

/** A small divided list; antd's List is deprecated and Listy is a virtual scroller, overkill here. */
function Rows({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid' }}>{children}</div>;
}

function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: '8px 0', borderBottom: '1px solid rgba(5, 5, 5, 0.06)', cursor: onClick ? 'pointer' : undefined }}
    >
      {children}
    </div>
  );
}
