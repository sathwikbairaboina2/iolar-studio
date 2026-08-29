'use client';
import { useState } from 'react';
import { Alert, Button, Modal, Space, Tag, Tooltip, Typography, message } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import { MAX_SLIDES, type Post } from '@/lib/schema';

/**
 * Final review before publishing: every rendered page side by side, drag to reorder,
 * drop the ones you do not want, then accept the cut and package it.
 */
export default function ReviewPanel({
  subject, chapter, part, post, version, fill, open, onClose, onApplied,
}: {
  subject: string;
  chapter: string;
  part: number;
  post: Post;
  version: number;
  fill: Record<number, number>;
  open: boolean;
  onClose: () => void;
  onApplied: (p: Post) => void | Promise<void>;
}) {
  const [order, setOrder] = useState<number[] | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const current = order ?? post.slides.map((_, i) => i);
  const dirty = order !== null && order.join() !== post.slides.map((_, i) => i).join();

  const move = (from: number, to: number) => {
    const next = [...current];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setOrder(next);
  };

  const drop = (index: number) => {
    const list = [...current];
    list.splice(index, 1);
    setOrder(list);
  };

  const accept = async () => {
    setBusy(true);
    try {
      // Reordering breaks the spill chain, so the flags go with the old sequence.
      const slides = current.map((i) => {
        const s = { ...post.slides[i] };
        delete s.cont;
        return s;
      });
      const saved = await fetch(`/api/handbooks/${subject}/${chapter}/parts/${part}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...post, slides }),
      });
      if (!saved.ok) throw new Error((await saved.json()).error ?? 'save failed');
      const fresh = await saved.json();

      const pkg = await fetch(`/api/handbooks/${subject}/${chapter}/parts/${part}/package`, { method: 'POST' });
      const body = await pkg.json();
      if (!pkg.ok) throw new Error(body.error ?? 'package failed');

      message.success(`Accepted — packaged ${body.files.length - 1} pages to ${body.dir}`);
      setOrder(null);
      await onApplied(fresh);
      onClose();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Review & accept final cut"
      open={open}
      onCancel={() => !busy && onClose()}
      width="92vw"
      footer={
        <Space>
          {dirty && <Tag color="orange">reordered — not saved</Tag>}
          <Button onClick={() => setOrder(null)} disabled={!dirty || busy}>Reset order</Button>
          <Button onClick={onClose} disabled={busy}>Keep editing</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busy} onClick={accept}>
            Accept final cut ({current.length} pages)
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Drag a page to reorder it. Remove one with the bin. Accepting saves the order and writes
        the export folder.
      </Typography.Paragraph>

      {current.length > MAX_SLIDES && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${current.length} pages — Instagram shows ${MAX_SLIDES}. Drop pages here, or let the renderer move the surplus into a follow-up post.`}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {current.map((slideIndex, pos) => (
          <div
            key={slideIndex}
            draggable
            onDragStart={() => setDragFrom(pos)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== pos) move(dragFrom, pos);
              setDragFrom(null);
            }}
            style={{
              border: dragFrom === pos ? '2px solid #7c5cff' : '1px solid rgba(128,128,128,.25)',
              borderRadius: 8,
              padding: 6,
              cursor: 'grab',
              opacity: dragFrom === pos ? 0.5 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <HolderOutlined style={{ opacity: 0.5 }} />
              <b style={{ fontSize: 12 }}>{pos + 1}</b>
              {fill[slideIndex + 1] != null && (
                <Tooltip title="page fill">
                  <Tag color={fill[slideIndex + 1] >= 85 ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>
                    {fill[slideIndex + 1]}%
                  </Tag>
                </Tooltip>
              )}
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                style={{ marginLeft: 'auto' }}
                onClick={() => drop(pos)}
                aria-label={`remove page ${pos + 1}`}
              />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/handbooks/${subject}/${chapter}/parts/${part}/render?slide=${slideIndex + 1}&t=${version}`}
              alt={`page ${pos + 1}`}
              style={{ width: '100%', borderRadius: 4, pointerEvents: 'none' }}
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
            />
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
              {post.slides[slideIndex].page_title}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
