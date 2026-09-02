'use client';
import { Alert, Button, Card, Statistic, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';

export type PoolStatus = {
  filter: { category: string; techOnly: boolean };
  counts: { total: number; open: number; closed: number; newSinceLastPull: number };
  lastPull: { id: number; at: string; fetched: number; added: number; refreshed: number; closed: number; error: string | null } | null;
  sources: { enabled: number; total: number; lastError: string | null };
};

/** The research pool as the studio holds it, and one button to pull it again. */
export default function PoolPane({ pool, pulling, onPull }: { pool: PoolStatus | null; pulling: boolean; onPull: () => void }) {
  return (
    <Card
      size="small"
      title={`Pool · ${pool?.filter.category ?? '…'}${pool?.filter.techOnly ? ' · tech only' : ''}`}
      extra={
        <Button size="small" icon={<CloudDownloadOutlined />} loading={pulling} onClick={onPull} data-testid="pull-now">
          Pull now
        </Button>
      }
    >
      {pool?.lastPull?.error && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="The last pull failed" description={pool.lastPull.error} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <Statistic title="Open" value={pool?.counts.open ?? 0} />
        <Statistic title="New since last pull" value={pool?.counts.newSinceLastPull ?? 0} />
        <Statistic title="Closed" value={pool?.counts.closed ?? 0} />
        <Statistic title="Sources enabled" value={pool?.sources.enabled ?? 0} suffix={`/ ${pool?.sources.total ?? 0}`} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        {pool?.lastPull
          ? `last pull ${new Date(pool.lastPull.at).toLocaleString('en-GB')}: ${pool.lastPull.fetched} fetched, ${pool.lastPull.added} new, ${pool.lastPull.closed} closed`
          : 'never pulled'}
        {pool?.sources.lastError ? ` · a source reports: ${pool.sources.lastError}` : ''}
      </Typography.Text>
    </Card>
  );
}
