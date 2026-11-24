'use client';
import React from 'react';
import { Button, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { ExplainerSummary } from '@/lib/explainer/store';
import { ago } from '@/lib/explainer/browse';

/**
 * The same shelf as a table, for when you want to sort by length or read twenty at once.
 *
 * `nodes` is gone from it. How many rows a board has is a thing you tune inside one explainer and
 * never the thing you scan a list for; what you scan for is what you last touched.
 */

export default function ExplainerTable({
  rows, loading, onOpen, onDelete,
}: {
  rows: ExplainerSummary[];
  loading: boolean;
  onOpen: (slug: string) => void;
  onDelete: (slug: string) => void;
}) {
  return (
    <Table<ExplainerSummary>
      size="small"
      loading={loading}
      rowKey="slug"
      dataSource={rows}
      pagination={false}
      onRow={(r) => ({ onClick: () => onOpen(r.slug), style: { cursor: 'pointer' } })}
      columns={[
        {
          title: 'Title',
          dataIndex: 'title',
          className: 'st-title-col',
          sorter: (a, b) => a.title.localeCompare(b.title),
          render: (v: string) => <strong>{v}</strong>,
        },
        {
          title: 'Theme',
          dataIndex: 'theme',
          width: 130,
          sorter: (a, b) => a.theme.localeCompare(b.theme),
          render: (v: string) => <Tag>{v}</Tag>,
        },
        { title: 'Beats', dataIndex: 'beats', width: 80, sorter: (a, b) => a.beats - b.beats },
        {
          title: 'Length',
          dataIndex: 'seconds',
          width: 90,
          sorter: (a, b) => a.seconds - b.seconds,
          render: (v: number) => `${v}s`,
        },
        {
          title: 'Edited',
          dataIndex: 'updatedAt',
          width: 110,
          defaultSortOrder: 'descend',
          sorter: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
          render: (v: string) => (
            <Tooltip title={new Date(v).toLocaleString()}>
              <Typography.Text type="secondary">{ago(v)}</Typography.Text>
            </Tooltip>
          ),
        },
        {
          title: 'Rendered',
          dataIndex: 'renderedAt',
          width: 120,
          sorter: (a, b) => (a.renderedAt ?? '').localeCompare(b.renderedAt ?? ''),
          render: (v: string | null) =>
            v
              ? <Typography.Text type="secondary">{ago(v)}</Typography.Text>
              : <Tag>not yet</Tag>,
        },
        {
          title: '',
          key: 'actions',
          width: 80,
          // Every control in this column has to stop the click, or it also opens the row.
          onCell: () => ({ onClick: (e: React.MouseEvent) => e.stopPropagation() }),
          render: (_: unknown, row) => (
            <Space size={0}>
              <Tooltip title={row.renderedAt ? 'Play the reel' : 'Nothing rendered yet'}>
                <Button
                  size="small"
                  type="text"
                  icon={<PlayCircleOutlined />}
                  disabled={!row.renderedAt}
                  href={row.renderedAt ? `/api/explainers/${row.slug}/mp4` : undefined}
                  target="_blank"
                />
              </Tooltip>
              <Popconfirm
                title="Delete this explainer?"
                description="The document, its history and every render go with it."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDelete(row.slug)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  );
}
