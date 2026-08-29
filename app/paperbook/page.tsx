'use client';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Radio, Table, Tag, Typography, message } from 'antd';
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
  const [mode, setMode] = useState<'blank' | 'topic' | 'references'>('topic');
  const [topic, setTopic] = useState('');
  const [refText, setRefText] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const load = () => fetch('/api/paperbook').then((r) => r.json()).then((d) => setPosts(d.posts ?? []));
  useEffect(() => { load(); }, []);

  const validSlug = /^[a-z0-9-]+$/.test(slug);
  const refUrls = refText.split(/[\n,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  const canCreate = validSlug && !creating &&
    (mode === 'blank' || (mode === 'topic' && !!topic.trim()) || (mode === 'references' && refUrls.length > 0));

  const create = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/paperbook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? 'create failed');

      if (mode === 'references') {
        await fetch(`/api/paperbook/${slug}/references`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ urls: refUrls }),
        });
      }
      if (mode !== 'blank') {
        message.info(
          mode === 'topic'
            ? 'AI building the book (topic outline)…'
            : 'AI reading references and building the book… (a few minutes)'
        );
        const b = await fetch(`/api/paperbook/${slug}/book`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            mode === 'topic'
              ? { action: 'generate', mode: 'topic', topic }
              : { action: 'generate', mode: 'references', urls: refUrls }
          ),
        });
        const bd = await b.json();
        if (!b.ok) throw new Error(bd.error ?? 'book failed');
        message.info(`Book: ${bd.book.chapters.length} chapters — writing slides that cover every point…`);

        const p = await fetch(`/api/paperbook/${slug}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!p.ok) throw new Error((await p.json()).error ?? 'plan failed');
        message.info('Rendering slides…');
        await fetch(`/api/paperbook/${slug}/render`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
      }
      setOpen(false);
      router.push(`/paperbook/${slug}`);
    } catch (err) {
      message.error(String(err));
    } finally {
      setCreating(false);
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
        onCancel={() => !creating && setOpen(false)}
        okButtonProps={{ disabled: !canCreate, loading: creating }}
        okText={mode === 'blank' ? 'Create' : 'Create with AI'}
      >
        <Input
          placeholder="post-slug (lowercase, digits, dashes)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          status={slug && !validSlug ? 'error' : undefined}
          style={{ marginBottom: 12 }}
        />
        {slug && !validSlug && (
          <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            Only a-z, 0-9 and dashes.
          </Typography.Text>
        )}

        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ marginBottom: 12 }}
          options={[
            { label: 'AI from topic', value: 'topic' },
            { label: 'AI from reference images', value: 'references' },
            { label: 'Blank', value: 'blank' },
          ]}
          optionType="button"
        />

        {mode === 'topic' && (
          <Input.TextArea
            rows={2}
            placeholder='Topic, e.g. "Python decorators deep dive" — AI plans all slides'
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
        {mode === 'references' && (
          <>
            <Input.TextArea
              rows={5}
              placeholder={'Paste reference image URLs (one per line or comma-separated).\nAI analyzes them and generates fresh original slides on the same topic.'}
              value={refText}
              onChange={(e) => setRefText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {refUrls.length} valid URL(s) detected
            </Typography.Text>
          </>
        )}
      </Modal>
    </div>
  );
}
