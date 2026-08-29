'use client';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';

type Meta = { slug: string; title: string; template: string; slideCount: number; status: string; updatedAt: string };

const STATUS_COLOR: Record<string, string> = {
  draft: 'orange', rendered: 'blue', polished: 'purple', packaged: 'green',
};

export default function PaperbookList() {
  const [posts, setPosts] = useState<Meta[]>([]);
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const router = useRouter();

  const load = () => fetch('/api/paperbook').then((r) => r.json()).then((d) => setPosts(d.posts ?? []));
  useEffect(() => { load(); }, []);

  const validSlug = /^[a-z0-9-]+$/.test(slug);

  const create = async () => {
    const r = await fetch('/api/paperbook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    if (r.ok) {
      setOpen(false);
      router.push(`/paperbook/${slug}`);
    } else {
      message.error((await r.json()).error ?? 'failed');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Paperbook</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New post</Button>
      </div>

      <Table<Meta>
        rowKey="slug"
        dataSource={posts}
        onRow={(r) => ({ onClick: () => router.push(`/paperbook/${r.slug}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Post', dataIndex: 'slug', render: (s, r) => (<span><b>{s}</b><br /><small style={{ opacity: 0.6 }}>{r.title}</small></span>) },
          { title: 'Template', dataIndex: 'template', render: (t) => <Tag color="purple">{t}</Tag> },
          { title: 'Slides', dataIndex: 'slideCount' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          { title: 'Updated', dataIndex: 'updatedAt', render: (d) => new Date(d).toLocaleString() },
        ]}
      />

      <Modal
        title="New paperbook post"
        open={open}
        onOk={create}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: !validSlug }}
        okText="Create"
      >
        <Input
          placeholder="post-slug (lowercase, digits, dashes)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          status={slug && !validSlug ? 'error' : undefined}
        />
        {slug && !validSlug && (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            Only a-z, 0-9 and dashes.
          </Typography.Text>
        )}
      </Modal>
    </div>
  );
}
