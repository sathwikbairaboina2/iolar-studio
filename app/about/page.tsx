'use client';
import { useEffect, useState } from 'react';
import { Card, Tag, Typography } from 'antd';

/**
 * The studio explaining itself: one card per feature from docs/implementation.json. The
 * full handbook lives in docs/handbooks/ and at its published link; it is not embedded here.
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

export default function AboutPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
     
    void fetch('/api/about')
      .then((r) => r.json())
      .then((d) => {
        setFeatures(d.features ?? []);
        setUpdatedAt(d.updatedAt ?? '');
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 2 }}>
          How it works
        </Typography.Title>
        <Typography.Text type="secondary">
          What is implemented, as of {updatedAt || '…'}. Files and tests are listed under each feature.
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
    </div>
  );
}
