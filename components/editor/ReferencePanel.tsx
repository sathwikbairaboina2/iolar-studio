'use client';
import { useEffect, useState } from 'react';
import { Button, Drawer, Input, Space, Switch, Typography, message } from 'antd';
import { PictureOutlined } from '@ant-design/icons';

export function parseUrls(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
}

export default function ReferencePanel({
  slug, compare, onCompareChange, onUrlsChange,
}: {
  slug: string;
  compare: boolean;
  onCompareChange: (on: boolean) => void;
  onUrlsChange: (urls: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    fetch(`/api/paperbook/${slug}/references`)
      .then((r) => r.json())
      .then((d) => {
        const u = d.urls ?? [];
        setUrls(u);
        setText(u.join('\n'));
        onUrlsChange(u);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const save = async () => {
    const parsed = parseUrls(text);
    const r = await fetch(`/api/paperbook/${slug}/references`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: parsed }),
    });
    if (r.ok) {
      const d = await r.json();
      setUrls(d.urls);
      setText(d.urls.join('\n'));
      onUrlsChange(d.urls);
      message.success(`Saved ${d.urls.length} reference(s)`);
    } else {
      message.error('save failed');
    }
  };

  return (
    <>
      <Button icon={<PictureOutlined />} onClick={() => setOpen(true)}>
        References{urls.length ? ` (${urls.length})` : ''}
      </Button>

      <Drawer title="Reference images" open={open} onClose={() => setOpen(false)} width={460}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Paste URLs — one per line or comma-separated. Reference N pairs with slide N in compare mode.
        </Typography.Paragraph>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={'http://localhost:3000/api/media/…?child=1\nhttp://localhost:3000/api/media/…?child=2'}
          style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
        />
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" onClick={save}>Save</Button>
          <span>
            Compare beside preview <Switch checked={compare} onChange={onCompareChange} size="small" />
          </span>
        </Space>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {urls.map((u, i) => (
            <figure key={i} style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u}
                alt={`reference ${i + 1}`}
                style={{ width: '100%', borderRadius: 6, border: '1px solid rgba(128,128,128,.25)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }}
              />
              <figcaption style={{ fontSize: 11, opacity: 0.6, textAlign: 'center' }}>ref {i + 1}</figcaption>
            </figure>
          ))}
        </div>
      </Drawer>
    </>
  );
}
