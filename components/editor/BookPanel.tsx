'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { BookOutlined } from '@ant-design/icons';

export type Book = {
  title: string;
  summary: string;
  chapters: { title: string; points: string[] }[];
};

export default function BookPanel({ slug, onSlidesPlanned }: { slug: string; onSlidesPlanned: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [proposal, setProposal] = useState<Book | null>(null);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'' | 'generate' | 'revise' | 'slides'>('');

  const load = () => fetch(`/api/paperbook/${slug}/book`).then((r) => r.json()).then((d) => setBook(d.book));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);

  const points = book?.chapters.reduce((n, c) => n + c.points.length, 0) ?? 0;

  const call = async (body: object, phase: typeof busy) => {
    setBusy(phase);
    try {
      const r = await fetch(`/api/paperbook/${slug}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'failed');
      return d;
    } finally {
      setBusy('');
    }
  };

  const generate = async () => {
    message.info('Reading references and building the book… (a few minutes)');
    try {
      const d = await call({ action: 'generate', mode: 'references' }, 'generate');
      setBook(d.book);
      message.success(`Book built: ${d.book.chapters.length} chapters`);
    } catch (err) { message.error(String(err)); }
  };

  const revise = async () => {
    if (!request.trim()) return;
    try {
      const d = await call({ action: 'revise', request }, 'revise');
      setProposal(d.proposal);
    } catch (err) { message.error(String(err)); }
  };

  const applyProposal = async () => {
    const r = await fetch(`/api/paperbook/${slug}/book`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposal),
    });
    if (r.ok) {
      setBook((await r.json()).book);
      setProposal(null);
      setRequest('');
      message.success('Book updated');
    } else message.error('save failed');
  };

  const makeSlides = async () => {
    setBusy('slides');
    message.info('Writing slides that cover every point in the book…');
    try {
      const r = await fetch(`/api/paperbook/${slug}/plan`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'failed');
      message.success(`Generated ${d.slides.length} slides — rendering`);
      setOpen(false);
      await onSlidesPlanned();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy('');
    }
  };

  const view = proposal ?? book;

  return (
    <>
      <Button icon={<BookOutlined />} onClick={() => setOpen(true)}>
        Book{book ? ` (${book.chapters.length}ch · ${points}pts)` : ''}
      </Button>

      <Drawer title="Handbook — topic coverage" open={open} onClose={() => setOpen(false)} width={520}>
        {!book && (
          <Empty description="No book yet — build one from the reference images">
            <Button type="primary" loading={busy === 'generate'} onClick={generate}>
              ✦ Build book from references
            </Button>
          </Empty>
        )}

        {view && (
          <>
            {proposal && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="Proposed revision — review below"
                action={
                  <Space>
                    <Button size="small" type="primary" onClick={applyProposal}>Apply</Button>
                    <Button size="small" onClick={() => setProposal(null)}>Discard</Button>
                  </Space>
                }
              />
            )}

            <Typography.Title level={5} style={{ marginBottom: 2 }}>{view.title}</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{view.summary}</Typography.Paragraph>
            <Space style={{ marginBottom: 10 }} wrap>
              <Tag color="purple">{view.chapters.length} chapters</Tag>
              <Tag color="blue">{view.chapters.reduce((n, c) => n + c.points.length, 0)} points</Tag>
              <Button
                type="primary"
                loading={busy === 'slides'}
                onClick={makeSlides}
                style={{ background: 'linear-gradient(135deg,#7c5cff,#3ec5ff)', border: 'none' }}
              >
                ✦ Generate slides from book
              </Button>
              <Button size="small" loading={busy === 'generate'} onClick={generate}>Rebuild from references</Button>
            </Space>

            <Collapse
              size="small"
              style={{ marginBottom: 14 }}
              items={view.chapters.map((c, i) => ({
                key: String(i),
                label: <span style={{ fontSize: 13 }}>{i + 1}. {c.title} <Tag>{c.points.length}</Tag></span>,
                children: (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
                    {c.points.map((p, j) => <li key={j}>{p}</li>)}
                  </ul>
                ),
              }))}
            />

            <Typography.Text strong style={{ fontSize: 13 }}>Discuss / revise the book</Typography.Text>
            <Input.TextArea
              rows={2}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder='e.g. "add a chapter on generators", "merge chapters 3 and 4", "drop the deque points"'
              style={{ margin: '6px 0' }}
            />
            <Button loading={busy === 'revise'} onClick={revise} disabled={!request.trim()}>
              ✦ Revise book
            </Button>
          </>
        )}
      </Drawer>
    </>
  );
}
