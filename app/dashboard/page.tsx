'use client';
import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import {
  FileTextOutlined, VideoCameraOutlined, ClockCircleOutlined,
  MessageOutlined, SmileOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';

type Meta = { slug: string; title: string; template: string; slideCount: number; status: string; updatedAt: string };

const STATUS_COLOR: Record<string, string> = {
  draft: 'orange', rendered: 'blue', polished: 'purple', packaged: 'green',
};

const CATS = [
  { name: 'Paperbook', icon: <FileTextOutlined />, sub: 'Handwritten notes carousels', href: '/paperbook', active: true },
  { name: 'Reels', icon: <VideoCameraOutlined />, sub: 'Short video content', active: false },
  { name: 'Stories', icon: <ClockCircleOutlined />, sub: '24h vertical frames', active: false },
  { name: 'Quote cards', icon: <MessageOutlined />, sub: 'Single-image quotes', active: false },
  { name: 'Memes', icon: <SmileOutlined />, sub: 'Template-based memes', active: false },
];

export default function Dashboard() {
  const [posts, setPosts] = useState<Meta[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/paperbook').then((r) => r.json()).then((d) => setPosts(d.posts ?? []));
  }, []);

  const slides = posts.reduce((n, p) => n + (p.status !== 'draft' ? p.slideCount : 0), 0);

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}><Card><Statistic title="Total posts" value={posts.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="Slides rendered" value={slides} /></Card></Col>
        <Col span={6}><Card><Statistic title="Ready to publish" value={posts.filter((p) => p.status === 'packaged').length} /></Card></Col>
        <Col span={6}><Card><Statistic title="Drafts" value={posts.filter((p) => p.status === 'draft').length} /></Card></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        {CATS.map((c) => (
          <Col span={c.active ? 5 : 5} key={c.name} flex="1">
            <Card
              hoverable={c.active}
              onClick={() => c.active && c.href && router.push(c.href)}
              style={{ opacity: c.active ? 1 : 0.55 }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
              <b>{c.name}</b> {c.active ? <Tag color="blue">active</Tag> : <Tag>soon</Tag>}
              <div style={{ fontSize: 12, opacity: 0.6 }}>{c.sub}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Typography.Title level={5}>Recent posts</Typography.Title>
      <Table<Meta>
        rowKey="slug"
        dataSource={posts.slice(0, 5)}
        pagination={false}
        onRow={(r) => ({ onClick: () => router.push(`/paperbook/${r.slug}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Post', dataIndex: 'slug', render: (s, r) => (<span><b>{s}</b><br /><small style={{ opacity: 0.6 }}>{r.title}</small></span>) },
          { title: 'Template', dataIndex: 'template', render: (t) => <Tag color="purple">{t}</Tag> },
          { title: 'Slides', dataIndex: 'slideCount' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          { title: 'Updated', dataIndex: 'updatedAt', render: (d) => new Date(d).toLocaleString() },
        ]}
      />
    </div>
  );
}
