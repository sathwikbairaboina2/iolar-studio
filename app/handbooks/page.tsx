'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Input, Modal, Progress, Row, Statistic, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { isSlug, slugify } from '@/lib/paths';

type SubjectMeta = {
  slug: string; name: string; emoji: string; description: string; chapters: number; pages: number;
};

export default function HandbooksPage() {
  const [subjects, setSubjects] = useState<SubjectMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📓');
  const router = useRouter();

  const slug = slugify(name);
  const load = () => fetch('/api/handbooks').then((r) => r.json()).then((d) => setSubjects(d.subjects ?? []));
  useEffect(() => { load(); }, []);

  const create = async () => {
    const r = await fetch('/api/handbooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, name, emoji }),
    });
    if (r.ok) {
      setOpen(false);
      setName('');
      router.push(`/handbooks/${slug}`);
    } else {
      message.error((await r.json()).error ?? 'failed');
    }
  };

  const pages = subjects.reduce((n, s) => n + s.pages, 0);
  const chapters = subjects.reduce((n, s) => n + s.chapters, 0);

  return (
    <div>
      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={6}><Card size="small"><Statistic title="Subjects" value={subjects.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Chapters" value={chapters} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Pages rendered" value={pages} /></Card></Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Categories live" value={1} suffix={<span style={{ fontSize: 13, opacity: 0.6 }}>/ 5</span>} />
          </Card>
        </Col>
      </Row>

      <Typography.Title level={5}>Subjects</Typography.Title>
      {subjects.length === 0 ? (
        <Empty description="No subjects yet">
          <Button type="primary" onClick={() => setOpen(true)}>+ new subject</Button>
        </Empty>
      ) : (
        <Row gutter={[14, 14]}>
          {subjects.map((s) => (
            <Col span={6} key={s.slug}>
              <Card hoverable onClick={() => router.push(`/handbooks/${s.slug}`)}>
                <div style={{ fontSize: 25 }}>{s.emoji}</div>
                <Typography.Title level={5} style={{ margin: '9px 0 2px' }}>{s.name}</Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.description || 'No description'}</Typography.Text>
                <div style={{ display: 'flex', gap: 6, marginTop: 11 }}>
                  <Tag color="magenta">{s.chapters} chapters</Tag>
                  <Tag>{s.pages} pages</Tag>
                </div>
                <Progress percent={Math.min(100, s.pages * 2)} showInfo={false} size="small" style={{ marginTop: 10 }} />
              </Card>
            </Col>
          ))}
          <Col span={6}>
            <Card
              hoverable
              onClick={() => setOpen(true)}
              style={{ borderStyle: 'dashed', minHeight: 158, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span style={{ opacity: 0.65 }}>+ new subject</span>
            </Card>
          </Col>
        </Row>
      )}

      <Modal
        title="New subject"
        open={open}
        onOk={create}
        onCancel={() => setOpen(false)}
        okText="Create"
        okButtonProps={{ disabled: !isSlug(slug) }}
      >
        <Input
          placeholder="Subject name, e.g. System Design"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <Input
          addonBefore="emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          style={{ marginBottom: 10, maxWidth: 160 }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          subject-slug: <b>{slug || '—'}</b>
        </Typography.Text>
      </Modal>
    </div>
  );
}
