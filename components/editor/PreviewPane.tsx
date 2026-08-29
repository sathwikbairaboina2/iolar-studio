'use client';
import { useState } from 'react';
import { Alert, Button, Modal, Space, Typography } from 'antd';
import { ReloadOutlined, ExpandOutlined, AppstoreOutlined } from '@ant-design/icons';

export default function PreviewPane({
  slug, slide, slideCount, version, overflowPx, onRerender, onAiFix, rendering,
}: {
  slug: string;
  slide: number;
  slideCount: number;
  version: number;
  overflowPx: number | null;
  onRerender: () => void;
  onAiFix: () => void;
  rendering: boolean;
}) {
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState(false);
  const src = `/api/paperbook/${slug}/render?slide=${slide}&t=${version}`;

  return (
    <div style={{ position: 'sticky', top: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Typography.Text strong>Preview — slide {slide}/{slideCount}</Typography.Text>
        {rendering && <Typography.Text type="secondary">rendering…</Typography.Text>}
      </div>

      {overflowPx !== null && overflowPx > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`Slide overflows by ${overflowPx}px`}
          action={<Button size="small" danger onClick={onAiFix}>Auto-fix with AI</Button>}
        />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={version}
        src={src}
        alt={`slide ${slide} preview`}
        style={{
          width: '100%', borderRadius: 8, border: '1px solid rgba(128,128,128,.25)',
          boxShadow: '0 0 40px rgba(124,92,255,.15), 0 14px 40px rgba(0,0,0,.3)',
          background: '#0c0d13',
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
      />

      <Space style={{ marginTop: 10, justifyContent: 'center', width: '100%' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={onRerender} loading={rendering}>Re-render</Button>
        <Button size="small" icon={<ExpandOutlined />} onClick={() => setFull(true)}>Full size</Button>
        <Button size="small" icon={<AppstoreOutlined />} onClick={() => setSheet(true)}>Contact sheet</Button>
      </Space>

      <Modal open={full} onCancel={() => setFull(false)} footer={null} width="min(90vw, 760px)">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="full preview" style={{ width: '100%' }} />
      </Modal>

      <Modal open={sheet} onCancel={() => setSheet(false)} footer={null} width="90vw" title="Contact sheet">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {Array.from({ length: slideCount }, (_, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={i}
              src={`/api/paperbook/${slug}/render?slide=${i + 1}&t=${version}`}
              alt={`slide ${i + 1}`}
              style={{ width: '100%', borderRadius: 6, border: '1px solid rgba(128,128,128,.25)' }}
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}
