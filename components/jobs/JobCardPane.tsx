'use client';
import { Card, Empty, Typography } from 'antd';

/**
 * A card for one job, next to the reel a whole cut becomes. The pipeline tab turns a
 * period's rows into one reel; this one is meant to turn a single row into a post of
 * its own. Nothing is built behind it yet — the shape of the card is still to be said.
 */
export default function JobCardPane() {
  return (
    <Card size="small" title="Job card" data-testid="job-card">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Typography.Text type="secondary">
            One job, one card. Not built yet.
          </Typography.Text>
        }
      />
    </Card>
  );
}
