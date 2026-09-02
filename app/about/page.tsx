'use client';
import { useEffect, useState } from 'react';
import { Card, Tag, Typography } from 'antd';

/**
 * The studio explaining itself: one card per feature from docs/implementation.json, then
 * the handbook in full. A card's "in the handbook" jumps the frame to that section.
 */

type Feature = {
  key: string;
  title: string;
  status: 'built' | 'in-progress' | 'designed';
  summary: string;
  how: string[];
  files: string[];
  tests: string[];
  handbook: string;
};

const COLOUR = { built: 'green', 'in-progress': 'gold', designed: 'default' } as const;
const FRAME_TITLE = 'Reels Engine Handbook';

export default function AboutPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch('/api/about')
      .then((r) => r.json())
      .then((d) => {
        setFeatures(d.features ?? []);
        setUpdatedAt(d.updatedAt ?? '');
      })
      .catch(() => {});
  }, []);

  const jump = (anchor: string) => {
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[title="${FRAME_TITLE}"]`);
    if (!frame) return;
    frame.src = `/api/about?handbook=1${anchor}`;
    frame.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 2 }}>
          How it works
        </Typography.Title>
        <Typography.Text type="secondary">
          What is implemented, as of {updatedAt || '…'}. The handbook below has the detail.
        </Typography.Text>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {features.map((f) => (
          <Card
            key={f.key}
            size="small"
            title={
              <span>
                {f.title} <Tag color={COLOUR[f.status]}>{f.status}</Tag>
              </span>
            }
            extra={
              <a
                href={`/api/about?handbook=1${f.handbook}`}
                onClick={(e) => {
                  e.preventDefault();
                  jump(f.handbook);
                }}
              >
                in the handbook
              </a>
            }
          >
            <Typography.Paragraph style={{ marginBottom: 8 }}>{f.summary}</Typography.Paragraph>
            {f.how.length > 0 && (
              <ol style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13 }}>
                {f.how.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            )}
            <div style={{ fontSize: 12, display: 'grid', gap: 2 }}>
              {f.files.map((p) => (
                <code key={p}>{p}</code>
              ))}
              {f.tests.map((p) => (
                <code key={p} style={{ opacity: 0.7 }}>
                  {p}
                </code>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <iframe
        id="handbook"
        title={FRAME_TITLE}
        src="/api/about?handbook=1"
        style={{ width: '100%', height: '80vh', border: '1px solid var(--ant-color-border, #ddd)', borderRadius: 8, background: '#fff' }}
      />
    </div>
  );
}
