'use client';
import { use, useEffect, useState } from 'react';
import { Button, Card, Empty, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { message } from '@/lib/ui/message';
import { PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { isSlug, slugify } from '@/lib/paths';
import { SWEEP } from '@/components/ThemeProvider';

type ChapterMeta = {
  subject: string; slug: string; title: string; parts: number;
  points: number; pages: number; avgFill: number; status: string;
  partStatuses?: string[]; updatedAt: string;
};
type Subject = { slug: string; name: string; emoji: string; description: string };

const STATUS_COLOR: Record<string, string> = {
  draft: 'default', rendered: 'blue', polished: 'purple', packaged: 'gold', published: 'success',
};

export default function SubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = use(params);
  const [meta, setMeta] = useState<Subject | null>(null);
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const router = useRouter();

  const slug = slugify(title);
  const load = () =>
    fetch(`/api/handbooks/${subject}`).then((r) => r.json()).then((d) => {
      setMeta(d.subject ?? null);
      setChapters(d.chapters ?? []);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [subject]);

  const create = async () => {
    const r = await fetch(`/api/handbooks/${subject}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, title }),
    });
    if (r.ok) {
      setOpen(false);
      setTitle('');
      router.push(`/handbooks/${subject}/${slug}`);
    } else {
      message.error((await r.json()).error ?? 'failed');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {meta ? `${meta.emoji} ${meta.name}` : subject} · {chapters.length} chapters
        </Typography.Title>
        <Space style={{ marginLeft: 'auto' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>new chapter</Button>
        </Space>
      </div>

      {chapters.length === 0 ? (
        <Empty description="No chapters yet">
          <Button type="primary" onClick={() => setOpen(true)}>+ new chapter</Button>
        </Empty>
      ) : (
        chapters.map((c, i) => (
          <Card
            key={c.slug}
            size="small"
            hoverable
            style={{ marginBottom: 9 }}
            onClick={() => router.push(`/handbooks/${subject}/${c.slug}`)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <span
                style={{
                  width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff', backgroundImage: SWEEP,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{c.title}</b>
                <div style={{ fontSize: 11.5, opacity: 0.65 }}>
                  {c.points} points · {c.avgFill ? `${c.avgFill}% avg fill` : 'not rendered'}
                </div>
              </div>
              <Space size={4}>
                {Array.from({ length: c.parts }, (_, p) => {
                  const st = c.partStatuses?.[p];
                  return (
                    <Tooltip key={p} title={st ? `part ${p + 1}: ${st}` : `part ${p + 1}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {p > 0 && <span style={{ opacity: 0.5, fontSize: 11 }}>⛓</span>}
                        <Tag
                          color={st === 'published' ? 'success' : p === 0 ? 'magenta' : 'purple'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          part {p + 1}{st === 'published' ? ' ✓' : ''}
                        </Tag>
                      </span>
                    </Tooltip>
                  );
                })}
              </Space>
              <Tag color={STATUS_COLOR[c.status] ?? 'default'}>{c.status}</Tag>
              <Button size="small">open</Button>
            </div>
          </Card>
        ))
      )}

      <Modal
        title="New chapter"
        open={open}
        onOk={create}
        onCancel={() => setOpen(false)}
        okText="Create"
        okButtonProps={{ disabled: !isSlug(slug) }}
      >
        <Input
          placeholder="Chapter title, e.g. Data Structures — Deep Dive"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          chapter-slug: <b>{slug || '—'}</b>
        </Typography.Text>
      </Modal>
    </div>
  );
}
