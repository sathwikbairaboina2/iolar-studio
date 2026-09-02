'use client';
import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { Cut } from '@/lib/jobs/ledger';

const STATUS_COLOUR: Record<Cut['status'], string> = {
  prepared: 'blue',
  thin: 'gold',
  submitted: 'geekblue',
  summarised: 'cyan',
  planned: 'green',
  failed: 'red',
  scripted: 'purple',
  voiced: 'cyan',
  building: 'processing',
};

/** The ledger of cuts, newest period first, and the two prepare buttons. */
export default function CutsPane({
  cuts,
  preparing,
  selectedId,
  boardBase,
  onPrepare,
  onSelect,
}: {
  cuts: Cut[];
  preparing: 'weekly' | 'daily' | null;
  selectedId: number | null;
  boardBase: string;
  onPrepare: (kind: 'weekly' | 'daily') => void;
  onSelect: (id: number) => void;
}) {
  return (
    <Card
      size="small"
      title="Cuts"
      extra={
        <Space size={4}>
          <Button size="small" loading={preparing === 'weekly'} onClick={() => onPrepare('weekly')} data-testid="prepare-week">
            Prepare week
          </Button>
          <Button size="small" loading={preparing === 'daily'} onClick={() => onPrepare('daily')} data-testid="prepare-day">
            Prepare today
          </Button>
        </Space>
      }
    >
      <Table<Cut>
        rowKey="id"
        size="small"
        dataSource={cuts}
        pagination={false}
        locale={{ emptyText: 'No cuts yet. Pull the pool, then prepare a week.' }}
        onRow={(row) => ({ onClick: () => onSelect(row.id), style: { cursor: 'pointer', background: row.id === selectedId ? 'rgba(192, 42, 88, 0.06)' : undefined } })}
        columns={[
          { title: 'Period', dataIndex: 'periodKey', width: 120, render: (k: string) => <strong>{k}</strong> },
          { title: 'Kind', dataIndex: 'kind', width: 80 },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 110,
            render: (s: Cut['status']) => <Tag color={STATUS_COLOUR[s]}>{s}</Tag>,
          },
          { title: 'Rows', dataIndex: 'counted', width: 70 },
          { title: 'Rejected', dataIndex: 'rejected', width: 90 },
          {
            title: 'Updated',
            dataIndex: 'updatedAt',
            width: 170,
            render: (v: string) => <Typography.Text type="secondary">{new Date(v).toLocaleString('en-GB')}</Typography.Text>,
          },
          {
            title: '',
            key: 'board',
            render: (_: unknown, row) =>
              ['submitted', 'summarised', 'planned'].includes(row.status) ? (
                <Button size="small" type="link" href={`${boardBase}/week/${row.periodKey}`} target="_blank">
                  open on board
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
