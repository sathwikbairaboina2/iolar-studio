'use client';
import { Button, Switch, Tag, Typography } from 'antd';

function ago(iso?: string) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

/** The aiiolar line above the chapter list: what is live, the Always ask me switch and the review queue. */
export function PublishStrip({ liveCount, name, updatedAt, alwaysAsk, queueCount, onAlwaysAsk, onQueue }: {
  liveCount: number; name: string; updatedAt?: string; alwaysAsk: boolean; queueCount: number;
  onAlwaysAsk: (v: boolean) => void; onQueue: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, margin: '0 0 14px', padding: '12px 16px',
        border: '1px solid rgba(128,128,128,.2)', borderRadius: 12, background: 'linear-gradient(90deg,rgba(252,176,69,.08),rgba(131,58,180,.08))',
      }}
    >
      <div>
        <b style={{ fontSize: 15 }}>aiiolar.com</b> <Tag color="purple" style={{ marginInlineStart: 6 }}>beta</Tag>
        <div style={{ fontSize: 12.5, opacity: 0.65 }}>
          {liveCount} {liveCount === 1 ? 'chapter' : 'chapters'} live · {name}{updatedAt ? ` · updated ${ago(updatedAt)}` : ''}
        </div>
      </div>
      <span style={{ flex: 1 }} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Every chapter and the order wait for you before they go live">
        <Switch size="small" checked={alwaysAsk} onChange={onAlwaysAsk} aria-label="Always ask me" />
        <Typography.Text>Always ask me</Typography.Text>
      </label>
      <Button onClick={onQueue} style={{ borderColor: '#d3adf7', color: '#722ed1' }}>
        Review queue <Tag color="gold" style={{ marginInlineEnd: 0, marginInlineStart: 6 }}>{queueCount}</Tag>
      </Button>
    </div>
  );
}
